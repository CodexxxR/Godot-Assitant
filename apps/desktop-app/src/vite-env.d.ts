/// <reference types="vite/client" />

import type {
  GeneratedProjectFile,
  GenerationAsset,
  ProjectAsset,
  ProjectFile,
  ProjectTypeInfo,
  SelectedProject,
  SystemInfo,
} from "./types/project";

declare global {
  interface Window {
    assistant?: {
      selectProjectFolder: () => Promise<SelectedProject | null>;
      selectGenerationParentFolder: () => Promise<string | null>;
      selectGenerationAssets: () => Promise<GenerationAsset[]>;
      inspectGenerationAssets: (payload: {
        paths: string[];
      }) => Promise<GenerationAsset[]>;
      getDroppedFilePath: (file: File) => Promise<string>;
      rememberProject: (payload: {
        rootPath: string;
        name: string;
      }) => Promise<boolean>;
      loadLastProject: () => Promise<SelectedProject | null>;
      listProjectFiles: (payload: {
        rootPath: string;
      }) => Promise<ProjectFile[]>;
      readProjectFile: (payload: {
        rootPath: string;
        filePath: string;
      }) => Promise<string>;
      readProjectAsset: (payload: {
        rootPath: string;
        filePath: string;
      }) => Promise<ProjectAsset>;
      loadProjectTypeInfo: (payload: {
        rootPath: string;
      }) => Promise<ProjectTypeInfo>;
      writeProjectFile: (payload: {
        rootPath: string;
        filePath: string;
        text: string;
      }) => Promise<boolean>;
      createProjectFile: (payload: {
        rootPath: string;
        filePath: string;
        text?: string;
      }) => Promise<ProjectFile>;
      deleteProjectFile: (payload: {
        rootPath: string;
        filePath: string;
      }) => Promise<{
        filePath: string;
      }>;
      writeGeneratedProject: (payload: {
        parentPath: string;
        projectName: string;
        files: GeneratedProjectFile[];
        assetPaths: string[];
      }) => Promise<SelectedProject>;
      getSystemInfo: () => Promise<SystemInfo>;
    };
  }
}
