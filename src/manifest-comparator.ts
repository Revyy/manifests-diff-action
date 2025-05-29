import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as core from '@actions/core'
import { createTwoFilesPatch } from 'diff'
import { KubernetesObject, ManifestDiff } from './types.js'

export class ManifestComparator {
  async compare(
    currentManifestsPath: string,
    targetManifestsPath: string
  ): Promise<void> {
    const currentObjects = await this.parseManifests(currentManifestsPath)
    const targetObjects = await this.parseManifests(targetManifestsPath)

    const diffs = this.computeDiffs(currentObjects, targetObjects)

    if (diffs.length === 0) {
      core.info('No differences found between manifests')
      return
    }

    this.printDiffs(diffs)
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
