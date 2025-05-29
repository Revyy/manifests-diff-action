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
  CONTINUATION_HEADER: '## 🔍 Kubernetes Manifests Diff (continued)\n\n',

  /**
   * Header template for the comment section, with placeholders for dynamic values
   */
  HEADER_TEMPLATE: `## 🔍 Kubernetes Manifests Diff

Found **{totalCount}** differences: {addedCount} added, {removedCount} removed, {modifiedCount} modified

`,

  /**
   * Footer template for the comment section, with placeholders for dynamic values
   */
  FOOTER_TEMPLATE: `
<hr>

**Summary:** {addedCount} added, {removedCount} removed, {modifiedCount} modified

<details>
<summary>ℹ️ How to read this diff</summary>

- ➕ **Added**: New Kubernetes objects that will be created
- ➖ **Removed**: Existing Kubernetes objects that will be deleted  
- 🔄 **Modified**: Existing Kubernetes objects that will be changed

Objects are identified by: \`{apiVersion}/{kind}/{namespace}/{name}\`
</details>
`
} as const
