import * as core from '@actions/core'
import { ManifestComparator } from './manifest-comparator.js'
import { GitHubPRCommenter } from './github-pr-commenter.js'
import { COMMENTS } from './constants.js'

export async function run(): Promise<void> {
  try {
    const currentManifestsPath = core.getInput('current_manifests_path', {
      required: true
    })
    const targetManifestsPath = core.getInput('target_manifests_path', {
      required: true
    })
    const githubToken =
      core.getInput('github_token') || process.env.GITHUB_TOKEN
    const title = core.getInput('title') || COMMENTS.DEFAULT_TITLE
    const subtitle = core.getInput('subtitle')

    // Set the GitHub token as environment variable for the action
    if (!githubToken) {
      throw new Error('GitHub token is required but not provided.')
    }

    core.info(`Comparing manifests:`)
    core.info(`Current branch: ${currentManifestsPath}`)
    core.info(`Target branch: ${targetManifestsPath}`)

    const comparator = new ManifestComparator()
    const diffs = await comparator.computeDiffs(
      currentManifestsPath,
      targetManifestsPath
    )

    const commenter = new GitHubPRCommenter(githubToken, title, subtitle)
    await commenter.postPullRequestComments(diffs)
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`)
  }
}
