import { useMemo, useState } from "react";
import {
  DeleteRounded,
  FolderRounded,
  ImageRounded,
  InsertDriveFileRounded,
  KeyboardArrowDownRounded,
  KeyboardArrowRightRounded,
  KeyboardDoubleArrowLeftRounded,
  KeyboardDoubleArrowRightRounded,
} from "@mui/icons-material";
import type { FileTreeNode, ProjectFile } from "../types/project";

type FileTreeProps = {
  files: ProjectFile[];
  activePath?: string;
  indexedCount: number;
  totalCount: number;
  isCollapsed?: boolean;
  deletingPath?: string;
  onSelect: (file: ProjectFile) => void;
  onDelete?: (file: ProjectFile) => void;
  onTogglePanel?: () => void;
};

const buildTree = (files: ProjectFile[]): FileTreeNode[] => {
  const root: FileTreeNode = {
    name: "",
    path: "",
    type: "folder",
    children: [],
  };

  files.forEach((file) => {
    const parts = file.path.split(/[\\/]/);
    let cursor = root;

    parts.forEach((part, index) => {
      const nodePath = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = cursor.children.find((child) => child.name === part);

      if (!node) {
        node = {
          name: part,
          path: nodePath,
          type: isFile ? "file" : "folder",
          children: [],
          file: isFile ? file : undefined,
        };
        cursor.children.push(node);
      }

      cursor = node;
    });
  });

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(root.children);
  return root.children;
};

const collectFolderPaths = (nodes: FileTreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === "folder" ? [node.path, ...collectFolderPaths(node.children)] : []
  );

export function FileTree({
  files,
  activePath,
  indexedCount,
  totalCount,
  isCollapsed = false,
  deletingPath,
  onSelect,
  onDelete,
  onTogglePanel,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(collectFolderPaths(tree))
  );

  const toggleFolder = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: FileTreeNode, depth: number) => {
    const isExpanded = !collapsed.has(node.path);

    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <button
            className="tree-row"
            style={{ paddingLeft: 10 + depth * 14 }}
            type="button"
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? <KeyboardArrowDownRounded /> : <KeyboardArrowRightRounded />}
            <FolderRounded />
            <span>{node.name}</span>
          </button>
          {isExpanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`tree-row file-row ${activePath === node.path ? "active" : ""}`}
        style={{ paddingLeft: 28 + depth * 14 }}
      >
        <button
          className="tree-file-button"
          type="button"
          onClick={() => node.file && onSelect(node.file)}
        >
          {node.file?.kind === "image" ? <ImageRounded /> : <InsertDriveFileRounded />}
          <span>{node.name}</span>
        </button>
        {node.file && onDelete ? (
          <button
            className="tree-delete-button"
            disabled={deletingPath === node.file.path}
            onClick={() => node.file && onDelete(node.file)}
            title={`Delete ${node.name}`}
            type="button"
          >
            <DeleteRounded />
          </button>
        ) : null}
      </div>
    );
  };

  if (isCollapsed) {
    return (
      <section className="panel panel-rail left-panel" aria-label="Files collapsed">
        <button
          className="panel-rail-button"
          onClick={onTogglePanel}
          title="Expand files"
          type="button"
        >
          <KeyboardDoubleArrowRightRounded />
          <span>Files</span>
        </button>
      </section>
    );
  }

  return (
    <section className="panel left-panel">
      <div className="panel-header">
        <div>
          <h2>Files</h2>
          <span>{totalCount ? `${indexedCount}/${totalCount} indexed` : "No project"}</span>
        </div>
        <div className="panel-header-actions">
          <button
            className="icon-button compact-icon"
            onClick={onTogglePanel}
            title="Collapse files"
            type="button"
          >
            <KeyboardDoubleArrowLeftRounded />
          </button>
        </div>
      </div>
      <div className="tree-scroller">
        {tree.length ? tree.map((node) => renderNode(node, 0)) : <p className="empty-state">Select a project</p>}
      </div>
    </section>
  );
}
