import * as fs from 'fs'
import { parseDocument } from 'yaml'
import * as core from '@actions/core'

import { createTwoFilesPatch } from 'diff'
import { KubernetesObject, ManifestDiff, YamlDocument } from './types.js'
import { KUBERNETES } from './constants.js'

/**
 * Compares Kubernetes manifest files and generates diffs between them.
 * Handles parsing YAML documents, identifying changes, and creating unified diffs.
 */
export class ManifestComparator {
  /**
   * Computes differences between current and target Kubernetes manifests.
   *
   * @param currentManifestsPath - Path to a file containing current manifest objects
   * @param targetManifestsPath - Path to a file containing target manifest objects
   * @returns Promise that resolves to an array of manifest differences
   */
  async computeDiffs(
    currentManifestsPath: string,
    targetManifestsPath: string
  ): Promise<ManifestDiff[]> {
    const currentObjects = await this.parseManifests(currentManifestsPath)
    const targetObjects = await this.parseManifests(targetManifestsPath)

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
        const currentYaml = currentObj.toString()
        const targetYaml = targetObj.toString()

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

  /**
   * Parses a YAML file containing multiple Kubernetes manifest documents.
   * Each document is separated by '---' and converted to a KubernetesObject.
   *
   * @param filePath - Path to the YAML file to parse
   * @returns Promise that resolves to a Map where keys are object identifiers and values are parsed Kubernetes objects
   * @private
   */
  private async parseManifests(
    filePath: string
  ): Promise<Map<string, YamlDocument>> {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const objects = new Map<string, YamlDocument>()

    try {
      const documents: YamlDocument[] = content
        .split(/^\s*---\s*$/m) // Split by '---'
        .map((doc) => parseDocument(doc.trim())) // Parse each document

      for (const doc of documents) {
        if (this.isValidKubernetesObject(doc.toJS())) {
          const key = this.getObjectKey(doc.toJS() as KubernetesObject)
          objects.set(key, doc)
        } else {
          throw new Error(
            `Invalid Kubernetes object in ${filePath}: ${JSON.stringify(doc)}`
          )
        }
      }
    } catch (error) {
      throw new Error(`Failed to parse YAML document in ${filePath}: ${error}`)
    }

    core.info(`Parsed ${objects.size} objects from ${filePath}`)
    return objects
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isValidKubernetesObject(obj: any): boolean {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.kind === 'string' &&
      typeof obj.apiVersion === 'string' &&
      obj.metadata &&
      typeof obj.metadata.name === 'string'
    )
  }

  /**
   * Generates a unique key for a Kubernetes object based on its metadata.
   * The key format is: {apiVersion}/{kind}/{namespace}/{name}
   *
   * @param obj - The Kubernetes object to generate a key for
   * @returns A unique string identifier for the object
   * @private
   */
  private getObjectKey(obj: KubernetesObject): string {
    const namespace = obj.metadata.namespace || KUBERNETES.DEFAULT_NAMESPACE
    return `${obj.apiVersion}/${obj.kind}/${namespace}/${obj.metadata.name}`
  }
}
