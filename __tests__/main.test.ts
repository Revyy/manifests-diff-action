/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { COMMENTS } from '../src/constants.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)

// Mock fs module
const mockReadFile = jest.fn()
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: mockReadFile
  }
}))

const mockListComments = jest.fn() as jest.MockedFunction<any>
const mockCreateComment = jest.fn() as jest.MockedFunction<any>
const mockGraphql = jest.fn() as jest.MockedFunction<any>

const mockOctokit = {
  graphql: mockGraphql,
  rest: {
    issues: {
      listComments: mockListComments,
      createComment: mockCreateComment
    }
  }
}

// Mock github octokit
jest.unstable_mockModule('@actions/github', () => ({
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    },
    payload: {
      pull_request: {
        number: 1
      }
    }
  },
  getOctokit: () => mockOctokit
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'current_manifests_path':
          return 'source.yaml'
        case 'target_manifests_path':
          return 'target.yaml'
        case 'github_token':
          return 'test-token'
        default:
          return ''
      }
    })

    mockListComments.mockResolvedValue([])
    mockGraphql.mockResolvedValue({})
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should detect differences between YAML files', async () => {
    const sourceYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.20`

    const targetYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.21`

    // Mock file reads
    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(sourceYaml)
      if (filePath === 'target.yaml') return Promise.resolve(targetYaml)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining(
          'Found **1** differences: 0 added, 0 removed, 1 modified'
        )
      })
    )

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('should detect no differences when YAML files are identical', async () => {
    const yamlContent = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 2`

    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(yamlContent)
      if (filePath === 'target.yaml') return Promise.resolve(yamlContent)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining('No manifest differences found')
      })
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('should fail if yaml is not a valid kubernetes yaml file(contains kind, metadata.name, apiVersion)', async () => {
    const invalidYaml = `apiVersion: apps/v1
metadata:
  name: test-app
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.20
      - name: sidecar
          image: busybox  # Invalid indentation - should be aligned with 'name'
        command: ["/bin/sh"]
    volumes:
    - name: data
      hostPath:
        path: /data
  # Missing closing bracket or invalid nesting
  invalidKey: [unclosed, array`

    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(invalidYaml)
      if (filePath === 'target.yaml') return Promise.resolve(invalidYaml)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).not.toHaveBeenCalled()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse YAML document')
    )
  })

  it('should fail when github token is missing', async () => {
    core.getInput.mockImplementation(() => '')

    await run()

    expect(mockCreateComment).not.toHaveBeenCalled()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('GitHub token is required but not provided.')
    )
  })

  it('should fail if one of the files are missing', async () => {
    mockReadFile.mockImplementation(() => {
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).not.toHaveBeenCalled()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('File not found')
    )
  })

  it('should handle complex nested YAML differences', async () => {
    const sourceYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  config.yaml: |
    database:
      host: localhost
      port: 5432
    features:
      - feature1
      - feature2`

    const targetYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  config.yaml: |
    database:
      host: prod-db
      port: 5432
    features:
      - feature1
      - feature3`

    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(sourceYaml)
      if (filePath === 'target.yaml') return Promise.resolve(targetYaml)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining(
          'Found **1** differences: 0 added, 0 removed, 1 modified'
        )
      })
    )

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('should handle multiple YAML documents in a single file', async () => {
    const sourceYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: config1
data:
  key: value1
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app1
spec:
  replicas: 1
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app2
spec:
  replicas: 1`

    const targetYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: config1
data:
  key: value2
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app1
spec:
  replicas: 2
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: service1
data:
  key: value3`

    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(sourceYaml)
      if (filePath === 'target.yaml') return Promise.resolve(targetYaml)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining(
          'Found **4** differences: 1 added, 1 removed, 2 modified'
        )
      })
    )

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('should minimise old comments on the PR', async () => {
    const sourceYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.20`

    const targetYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.21`

    // Mock existing comments including bot comments from previous runs
    mockListComments.mockResolvedValue({
      data: [
        {
          id: 1,
          node_id: 'MDEyOklzc3VlQ29tbWVudDE=',
          user: { type: 'Bot' },
          body: `🔍 ${COMMENTS.DEFAULT_TITLE}\n\nFound **2** differences...`
        },
        {
          id: 2,
          node_id: 'MDEyOklzc3VlQ29tbWVudDI=',
          user: { type: 'User' },
          body: 'This is a regular user comment'
        },
        {
          id: 3,
          node_id: 'MDEyOklzc3VlQ29tbWVudDM=',
          user: { type: 'Bot' },
          body: `🔍 ${COMMENTS.DEFAULT_TITLE}\n\nNo manifest differences found`
        }
      ]
    })

    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(sourceYaml)
      if (filePath === 'target.yaml') return Promise.resolve(targetYaml)
      return Promise.reject(new Error('File not found'))
    })

    await run()

    // Should have called listComments to get existing comments
    expect(mockListComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 1
    })

    // Should have called GraphQL mutation to minimize bot comments (2 times)
    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('minimizeComment')
    )
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('MDEyOklzc3VlQ29tbWVudDE=')
    )
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('MDEyOklzc3VlQ29tbWVudDM=')
    )

    // Should still create a new comment with the current diff
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining(
          'Found **1** differences: 0 added, 0 removed, 1 modified'
        )
      })
    )

    expect(core.warning).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('should fall back to console output when posting PR comment fails', async () => {
    const sourceYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.20`

    const targetYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.21`

    // Mock file reads
    mockReadFile.mockImplementation((filePath: unknown) => {
      if (filePath === 'source.yaml') return Promise.resolve(sourceYaml)
      if (filePath === 'target.yaml') return Promise.resolve(targetYaml)
      return Promise.reject(new Error('File not found'))
    })

    // Mock createComment to fail
    mockCreateComment.mockRejectedValue(new Error('API rate limit exceeded'))

    await run()

    // Should have attempted to create a comment
    expect(mockCreateComment).toHaveBeenCalled()

    // Should log error about failed PR comment
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post PR comments')
    )

    // Should log the diff info to console as fallback
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Found 1 differences')
    )

    // Should not fail the action
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
