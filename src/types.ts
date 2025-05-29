export interface KubernetesObject {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace?: string
  }
}

export interface ManifestDiff {
  objectKey: string
  status: 'added' | 'removed' | 'modified'
  currentObject?: KubernetesObject
  targetObject?: KubernetesObject
  diff?: string
}
