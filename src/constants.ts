/**
 * Application-wide constants used across different modules.
 */

/**
 * GitHub API and comment-related constants
 */
export const GITHUB = {
  /**
   * Maximum length for a GitHub comment before it needs to be split.
   * GitHub's actual limit is ~65536 chars, but we use a lower value for safety.
   */
  MAX_COMMENT_LENGTH: 60000,

  /**
   * Buffer space to reserve when calculating comment length limits.
   * This accounts for footers, continuation text, and formatting.
   */
  COMMENT_LENGTH_BUFFER: 100
} as const

/**
 * Kubernetes manifest constants
 */
export const KUBERNETES = {
  /**
   * Default namespace used when a Kubernetes object doesn't specify one
   */
  DEFAULT_NAMESPACE: 'default',

  /**
   * YAML document separator used to split multi-document files
   */
  DOCUMENT_SEPARATOR: /^---$/m
} as const

/**
 * Comment formatting constants
 */
export const COMMENTS = {
  /**
   * Text shown when a comment is continued in the next comment
   */
  CONTINUATION_TEXT: '\n\n---\n*Continued in next comment...*',

  /**
   * Header for continuation comments
   */
  CONTINUATION_HEADER: '## 🔍 Kubernetes Manifests Diff (continued)\n\n'
} as const
