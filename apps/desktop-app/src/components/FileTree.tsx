import { useMemo, useState } from "react";
import {
  FolderRounded,
  ImageRounded,
  InsertDriveFileRounded,
  KeyboardArrowDownRounded,
  KeyboardArrowRightRounded,
} from "@mui/icons-material";
import type { FileTreeNode, ProjectFile } from "../types/project";

type FileTreeProps = {
  files: ProjectFile[];
  activePath?: string;
  indexedCount: number;
  totalCount: number;
  onSelect: (file: ProjectFile) => void;
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

export function FileTree({
  files,
  activePath,
  indexedCount,
  totalCount,
  onSelect,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
      <button
        key={node.path}
        className={`tree-row file-row ${activePath === node.path ? "active" : ""}`}
        style={{ paddingLeft: 28 + depth * 14 }}
        type="button"
        onClick={() => node.file && onSelect(node.file)}
      >
        {node.file?.kind === "image" ? <ImageRounded /> : <InsertDriveFileRounded />}
        <span>{node.name}</span>
      </button>
    );
  };

  return (
    <section className="panel left-panel">
      <div className="panel-header">
        <div>
          <h2>Files</h2>
          <span>{totalCount ? `${indexedCount}/${totalCount} indexed` : "No project"}</span>
        </div>
      </div>
      <div className="tree-scroller">
        {tree.length ? tree.map((node) => renderNode(node, 0)) : <p className="empty-state">Select a project</p>}
      </div>
    </section>
  );
}
