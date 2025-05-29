import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { createTwoFilesPatch } from 'diff'
import { KubernetesObject, ManifestDiff } from './types.js'

export class ManifestComparator {
  private octokit: ReturnType<typeof github.getOctokit> | null = null

  constructor() {
    const token = process.env.GITHUB_TOKEN
    if (token) {
      this.octokit = github.getOctokit(token)
    }
  }

  async compare(
    currentManifestsPath: string,
    targetManifestsPath: string
  ): Promise<void> {
    const currentObjects = await this.parseManifests(currentManifestsPath)
    const targetObjects = await this.parseManifests(targetManifestsPath)

    const diffs = this.computeDiffs(currentObjects, targetObjects)

    if (this.octokit && github.context.payload.pull_request) {
      await this.postPullRequestComments(diffs)
    } else {
      // Fallback to console output if not in PR context
      this.printDiffs(diffs)
    }
  }

  private async parseManifests(
    filePath: string
  ): Promise<Map<string, KubernetesObject>> {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const objects = new Map<string, KubernetesObject>()

    // Split by YAML document separator and parse each document
    const documents = content.split(/^---$/m).filter((doc) => doc.trim())

    for (const doc of documents) {
      try {
        const parsed = yaml.load(doc.trim()) as KubernetesObject
        if (parsed && parsed.kind && parsed.metadata?.name) {
          const key = this.getObjectKey(parsed)
          objects.set(key, parsed)
        }
      } catch (error) {
        core.warning(`Failed to parse YAML document: ${error}`)
      }
    }

    core.info(`Parsed ${objects.size} objects from ${filePath}`)
    return objects
  }

  private getObjectKey(obj: KubernetesObject): string {
    const namespace = obj.metadata.namespace || 'default'
    return `${obj.apiVersion}/${obj.kind}/${namespace}/${obj.metadata.name}`
  }

  private computeDiffs(
    currentObjects: Map<string, KubernetesObject>,
    targetObjects: Map<string, KubernetesObject>
  ): ManifestDiff[] {
    const diffs: ManifestDiff[] = []
    const allKeys = new Set([...currentObjects.keys(), ...targetObjects.keys()])

    for (const key of allKeys) {
      const currentObj = currentObjects.get(key)
      const targetObj = targetObjects.get(key)

      if (!currentObj && targetObj) {
        // Object was removed
        diffs.push({
          objectKey: key,
          status: 'removed',
          targetObject: targetObj
        })
      } else if (currentObj && !targetObj) {
        // Object was added
        diffs.push({
          objectKey: key,
          status: 'added',
          currentObject: currentObj
        })
      } else if (currentObj && targetObj) {
        // Compare objects
        const currentYaml = yaml.dump(currentObj, { sortKeys: true })
        const targetYaml = yaml.dump(targetObj, { sortKeys: true })

        if (currentYaml !== targetYaml) {
          const diff = createTwoFilesPatch(
            `target/${key}`,
            `current/${key}`,
            targetYaml,
            currentYaml,
            '',
            ''
          )

          diffs.push({
            objectKey: key,
            status: 'modified',
            currentObject: currentObj,
            targetObject: targetObj,
            diff
          })
        }
      }
    }

    return diffs
  }

  private async postPullRequestComments(diffs: ManifestDiff[]): Promise<void> {
    if (!this.octokit || !github.context.payload.pull_request) {
      core.warning(
        'GitHub token or PR context not available, falling back to console output'
      )
      this.printDiffs(diffs)
      return
    }

    try {
      // Minimize existing comments from this action
      await this.minimizeExistingComments()

      if (diffs.length === 0) {
        await this.postComment(
          '## 🎉 No manifest differences found\n\nAll Kubernetes manifests are identical between the current and target branches.'
        )
        return
      }

      const comments = this.formatDiffsAsComments(diffs)
      for (const comment of comments) {
        await this.postComment(comment)
      }
    } catch (error) {
      core.error(`Failed to post PR comments: ${error}`)
      // Fallback to console output
      this.printDiffs(diffs)
    }
  }

  private async minimizeExistingComments(): Promise<void> {
    if (!this.octokit) return

    const { owner, repo } = github.context.repo
    const prNumber = github.context.payload.pull_request!.number

    try {
      const comments = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber
      })

      const botComments = comments.data.filter(
        (comment) =>
          comment.user?.type === 'Bot' &&
          comment.body?.includes('🔍 Kubernetes Manifests Diff')
      )

      for (const comment of botComments) {
        await this.octokit.graphql(`
          mutation {
            minimizeComment(input: {
              subjectId: "${comment.node_id}"
              classifier: OUTDATED
            }) {
              minimizedComment {
                isMinimized
              }
            }
          }
        `)
      }
    } catch (error) {
      core.warning(`Failed to minimize existing comments: ${error}`)
    }
  }

  private formatDiffsAsComments(diffs: ManifestDiff[]): string[] {
    const comments: string[] = []
    const maxCommentLength = 1500 // GitHub comment limit is ~65536 chars

    let currentComment = this.getCommentHeader(diffs)
    const footer = this.getCommentFooter(diffs)
    const continuationText = '\n\n---\n*Continued in next comment...*'

    for (const diff of diffs) {
      const diffSection = this.formatDiffSection(diff)

      // Check if adding this diff would exceed the comment limit
      // Reserve space for either the footer (if last comment) or continuation text
      const reservedSpace = footer.length + 100 // Extra buffer for safety
      if (
        currentComment.length + diffSection.length + reservedSpace >
        maxCommentLength
      ) {
        // Close current comment and start a new one
        comments.push(currentComment + continuationText)
        currentComment = `## 🔍 Kubernetes Manifests Diff (continued)\n\n`
      }

      currentComment += diffSection
    }

    // Add summary to the last comment
    currentComment += footer
    comments.push(currentComment)

    core.info(`Formatted ${comments.length} comments for PR`)

    return comments
  }

  private getCommentHeader(diffs: ManifestDiff[]): string {
    const addedCount = diffs.filter((d) => d.status === 'added').length
    const removedCount = diffs.filter((d) => d.status === 'removed').length
    const modifiedCount = diffs.filter((d) => d.status === 'modified').length

    return `## 🔍 Kubernetes Manifests Diff

Found **${diffs.length}** differences: ${addedCount} added, ${removedCount} removed, ${modifiedCount} modified

`
  }

  private formatDiffSection(diff: ManifestDiff): string {
    const sections: string[] = []

    sections.push(
      `### ${this.getStatusEmoji(diff.status)} ${diff.status.toUpperCase()}: \`${diff.objectKey}\`\n`
    )

    if (diff.status === 'modified' && diff.diff) {
      sections.push('```diff')
      sections.push(diff.diff)
      sections.push('```\n')
    }

    return sections.join('\n')
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'added':
        return '➕'
      case 'removed':
        return '➖'
      case 'modified':
        return '🔄'
      default:
        return '📝'
    }
  }

  private getCommentFooter(diffs: ManifestDiff[]): string {
    const addedCount = diffs.filter((d) => d.status === 'added').length
    const removedCount = diffs.filter((d) => d.status === 'removed').length
    const modifiedCount = diffs.filter((d) => d.status === 'modified').length

    return `---

**Summary:** ${addedCount} added, ${removedCount} removed, ${modifiedCount} modified

<details>
<summary>ℹ️ How to read this diff</summary>

- ➕ **Added**: New Kubernetes objects that will be created
- ➖ **Removed**: Existing Kubernetes objects that will be deleted  
- 🔄 **Modified**: Existing Kubernetes objects that will be changed

Objects are identified by: \`{apiVersion}/{kind}/{namespace}/{name}\`
</details>
`
  }

  private async postComment(body: string): Promise<void> {
    if (!this.octokit) return

    const { owner, repo } = github.context.repo
    const prNumber = github.context.payload.pull_request!.number

    await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    })
  }

  private printDiffs(diffs: ManifestDiff[]): void {
    core.info(`\n🔍 Found ${diffs.length} differences:`)

    for (const diff of diffs) {
      core.info(`\n${'='.repeat(80)}`)

      switch (diff.status) {
        case 'added':
          core.info(`➕ ADDED: ${diff.objectKey}`)
          break
        case 'removed':
          core.info(`➖ REMOVED: ${diff.objectKey}`)
          break
        case 'modified':
          core.info(`🔄 MODIFIED: ${diff.objectKey}`)
          if (diff.diff) {
            core.info('\nDiff:')
            core.info(diff.diff)
          }
          break
      }
    }

    core.info(`\n${'='.repeat(80)}`)
    core.info(
      `Summary: ${diffs.filter((d) => d.status === 'added').length} added, ${diffs.filter((d) => d.status === 'removed').length} removed, ${diffs.filter((d) => d.status === 'modified').length} modified`
    )
  }
}
