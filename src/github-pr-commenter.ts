import * as github from '@actions/github'
import * as core from '@actions/core'
import { ManifestDiff } from './types.js'
import { GITHUB, COMMENTS } from './constants.js'

/**
 * Handles posting manifest diff comments to GitHub Pull Requests.
 * Provides functionality to format diffs as GitHub comments and manage comment lifecycle.
 */
export class GitHubPRCommenter {
  private octokit: ReturnType<typeof github.getOctokit>

  /**
   * Creates a new GitHubPRCommenter instance.
   *
   * @param token - GitHub personal access token for API authentication
   */
  constructor(token: string) {
    this.octokit = github.getOctokit(token)
  }

  /**
   * Posts manifest differences as comments on a GitHub Pull Request.
   * Falls back to console output if GitHub context is not available.
   *
   * @param diffs - Array of manifest differences to post as comments
   * @returns Promise that resolves when all comments have been posted
   */
  async postPullRequestComments(diffs: ManifestDiff[]): Promise<void> {
    if (!github.context.payload.pull_request) {
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

  /**
   * Minimizes existing comments from this action on the current Pull Request.
   * This helps keep the PR clean by collapsing outdated diff comments.
   *
   * @returns Promise that resolves when all existing comments have been minimized
   * @private
   */
  private async minimizeExistingComments(): Promise<void> {
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

  /**
   * Formats manifest diffs into GitHub comment strings.
   * Splits large diffs across multiple comments to respect GitHub's comment size limits.
   *
   * @param diffs - Array of manifest differences to format
   * @returns Array of formatted comment strings ready for posting
   * @private
   */
  private formatDiffsAsComments(diffs: ManifestDiff[]): string[] {
    const comments: string[] = []
    const maxCommentLength = GITHUB.MAX_COMMENT_LENGTH

    let currentComment = this.getCommentHeader(diffs)
    const footer = this.getCommentFooter(diffs)
    const continuationText = COMMENTS.CONTINUATION_TEXT

    for (const diff of diffs) {
      const diffSection = this.formatDiffSection(diff)

      // Check if adding this diff would exceed the comment limit
      // Reserve space for either the footer (if last comment) or continuation text
      const reservedSpace = footer.length + GITHUB.COMMENT_LENGTH_BUFFER
      if (
        currentComment.length + diffSection.length + reservedSpace >
        maxCommentLength
      ) {
        // Close current comment and start a new one
        comments.push(currentComment + continuationText)
        currentComment = COMMENTS.CONTINUATION_HEADER
      }

      currentComment += diffSection
    }

    // Add summary to the last comment
    currentComment += footer
    comments.push(currentComment)

    core.info(`Formatted ${comments.length} comments for PR`)

    return comments
  }

  /**
   * Generates the header section for diff comments including summary statistics.
   *
   * @param diffs - Array of manifest differences to summarize
   * @returns Formatted header string with diff counts
   * @private
   */
  private getCommentHeader(diffs: ManifestDiff[]): string {
    const counts = this.getDiffCounts(diffs)
    return this.replacePlaceholders(COMMENTS.HEADER_TEMPLATE, counts)
  }

  /**
   * Formats a single manifest diff into a comment section.
   *
   * @param diff - The manifest difference to format
   * @returns Formatted string representation of the diff
   * @private
   */
  private formatDiffSection(diff: ManifestDiff): string {
    const sections: string[] = []

    if (diff.status === 'modified' && diff.diff) {
      sections.push(
        `<details>\n<summary>${this.getStatusEmoji(diff.status)} ${diff.status.toUpperCase()}: \`${diff.objectKey}\`</summary>\n`
      )
      sections.push('```diff')
      sections.push(diff.diff)
      sections.push('```\n</details>\n')
    } else {
      sections.push(
        `### ${this.getStatusEmoji(diff.status)} ${diff.status.toUpperCase()}: \`${diff.objectKey}\`\n`
      )
    }

    return sections.join('\n')
  }

  /**
   * Returns the appropriate emoji for a given diff status.
   *
   * @param status - The status of the manifest diff (added, removed, modified)
   * @returns Emoji character representing the status
   * @private
   */
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

  /**
   * Generates the footer section for diff comments including summary and help text.
   *
   * @param diffs - Array of manifest differences to summarize
   * @returns Formatted footer string with summary and instructions
   * @private
   */
  private getCommentFooter(diffs: ManifestDiff[]): string {
    const counts = this.getDiffCounts(diffs)
    return this.replacePlaceholders(COMMENTS.FOOTER_TEMPLATE, counts)
  }

  /**
   * Calculates counts for different types of manifest changes.
   *
   * @param diffs - Array of manifest differences to count
   * @returns Object containing counts for each change type
   * @private
   */
  private getDiffCounts(diffs: ManifestDiff[]): {
    totalCount: number
    addedCount: number
    removedCount: number
    modifiedCount: number
  } {
    return {
      totalCount: diffs.length,
      addedCount: diffs.filter((d) => d.status === 'added').length,
      removedCount: diffs.filter((d) => d.status === 'removed').length,
      modifiedCount: diffs.filter((d) => d.status === 'modified').length
    }
  }

  /**
   * Replaces placeholders in template strings with actual values.
   *
   * @param template - Template string with placeholders in {key} format
   * @param values - Object containing values to replace placeholders
   * @returns String with all placeholders replaced
   * @private
   */
  private replacePlaceholders(
    template: string,
    values: Record<string, string | number>
  ): string {
    return template.replace(/{(\w+)}/g, (match, key) => {
      return values[key]?.toString() || match
    })
  }

  /**
   * Posts a comment to the current Pull Request.
   *
   * @param body - The comment body text to post
   * @returns Promise that resolves when the comment has been posted
   * @private
   */
  private async postComment(body: string): Promise<void> {
    const { owner, repo } = github.context.repo
    const prNumber = github.context.payload.pull_request!.number

    await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    })
  }

  /**
   * Prints manifest differences to the console as a fallback when GitHub API is not available.
   *
   * @param diffs - Array of manifest differences to print
   * @private
   */
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
