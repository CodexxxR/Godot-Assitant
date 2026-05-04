/// <reference types="vite/client" />

import type {
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
      getSystemInfo: () => Promise<SystemInfo>;
    };
  }
}
