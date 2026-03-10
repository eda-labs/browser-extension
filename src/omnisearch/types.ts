export interface NavItem {
  label: string;
  href: string;
  section: string;
  keywords: string;
}

export interface EqlResult {
  label: string;
  path: string;
  section: string;
  fields: Record<string, unknown>;
}

export interface EqlAutocompleteItem {
  value: string;
  suffix: string;
}

export interface ParsedKind {
  plural: string;
  kind: string;
  label: string;
  category: string;
  panel: string;
  group: string;
  version: string;
  namespaced?: boolean;
  isInstance?: boolean;
  instanceName?: string;
  instanceNamespace?: string;
  instanceSearchText?: string;
}

export interface AppsGroup {
  name?: string;
  preferredVersion?: { version?: string };
  versions?: Array<{ version?: string } | string>;
}
