// Та же модель, что у CLI (src/models): дерево Directory/File, корень — под своим именем.

export interface File {
  name: string;
  content: string;
  size: number;
}

export interface Directory {
  name: string;
  files: File[];
  subdirectories: Directory[];
}

export function countFiles(directory: Directory): number {
  return directory.subdirectories.reduce(
    (sum, sub) => sum + countFiles(sub),
    directory.files.length,
  );
}
