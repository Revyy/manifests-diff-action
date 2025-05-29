import * as core from '@actions/core'
import { ManifestComparator } from './manifest-comparator.js'

export async function run(): Promise<void> {
  try {
    const currentManifestsPath = core.getInput('current_manifests_path', {
      required: true
    })
    const targetManifestsPath = core.getInput('target_manifests_path', {
      required: true
    })

    core.info(`Comparing manifests:`)
    core.info(`Current branch: ${currentManifestsPath}`)
    core.info(`Target branch: ${targetManifestsPath}`)

    const comparator = new ManifestComparator()
    await comparator.compare(currentManifestsPath, targetManifestsPath)
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`)
  }
}

run()
