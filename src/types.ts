import { parseDocument } from 'yaml'

/**
 * Represents a parsed YAML document
 */
export type YamlDocument = ReturnType<typeof parseDocument>

/**
 * Represents a Kubernetes object with basic metadata
 */
export interface KubernetesObject {
  /** The API version of the Kubernetes object */
  apiVersion: string
  /** The kind/type of the Kubernetes object */
  kind: string
  /** Metadata containing object identification information */
  metadata: {
    /** The name of the Kubernetes object */
    name: string
    /** The namespace where the object is located (optional) */
    namespace?: string
  }
}

/**
 * Represents the difference between current and target Kubernetes manifests
 */
export interface ManifestDiff {
  /** Unique identifier for the Kubernetes object being compared */
  objectKey: string
  /** The type of change detected in the manifest */
  status: 'added' | 'removed' | 'modified'
  /** The current state of the Kubernetes object (if it exists) */
  currentObject?: YamlDocument
  /** The target state of the Kubernetes object (if it exists) */
  targetObject?: YamlDocument
  /** Human-readable diff string showing the changes */
  diff?: string
}
