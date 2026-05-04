import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import {
  AutoFixHighRounded,
  BugReportRounded,
  CheckRounded,
  CloseRounded,
  DataObjectRounded,
  ForumRounded,
  ImageRounded,
  SaveRounded,
  SyncRounded,
} from "@mui/icons-material";
import { useEffect, useRef, useState } from "react";
import type { EditorSelection, ProjectFile, ProjectTypeInfo } from "../types/project";

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<BeforeMount>[0];
type EditorReader = Pick<MonacoEditor, "getModel" | "getPosition" | "getSelection">;

type InlineState = {
  isLoading: boolean;
  suggestion: string;
  error: string;
};

type EditorPanelProps = {
  activeFile?: ProjectFile;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
  inlineState: InlineState;
  projectFiles: Record<string, string>;
  projectTypeInfo: ProjectTypeInfo;
  onApplyInline: () => void;
  onContentChange: (value: string) => void;
  onDebugSelection: (selection: EditorSelection) => void;
  onDismissInline: () => void;
  onExplainSelection: (selection: EditorSelection) => void;
  onGenerateRequest: (selection: EditorSelection, instruction: string) => void;
  onInlineRequest: (selection: EditorSelection, instruction: string) => void;
  onSave: () => void;
  onSelectionChange: (selection: EditorSelection) => void;
};

const MONACO_WORKSPACE_ROOT = "file:///workspace";
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  ".ico",
  ".tga",
  ".exr",
  ".hdr",
  ".dds",
  ".ktx",
  ".ktx2",
]);
const MODULE_DIAGNOSTICS_TO_IGNORE = [
  2307,
  2792,
  7016,
];
const REACT_AMBIENT_TYPES = `
declare namespace JSX {
  type Element = any;
  interface ElementClass {
    render: any;
  }
  interface ElementAttributesProperty {
    props: {};
  }
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: any;
  }
  interface IntrinsicClassAttributes<T> {
    ref?: any;
  }
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare namespace React {
  type ReactNode = any;
  type ReactElement = any;
  type CSSProperties = Record<string, string | number | undefined>;
  type SetStateAction<T> = T | ((previous: T) => T);
  type Dispatch<T> = (value: T) => void;
  type FC<P = {}> = (props: P) => ReactElement | null;
  type FunctionComponent<P = {}> = FC<P>;
  type ComponentType<P = {}> = any;
  type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  type Key = string | number;
  type Ref<T = any> = any;
  interface RefObject<T = any> {
    current: T | null;
  }
  interface MutableRefObject<T = any> {
    current: T;
  }
  interface ChangeEvent<T = Element> {
    target: T;
    currentTarget: T;
  }
  interface FormEvent<T = Element> {
    preventDefault(): void;
    target: T;
    currentTarget: T;
  }
  interface MouseEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    target: T;
    currentTarget: T;
  }
  interface KeyboardEvent<T = Element> extends MouseEvent<T> {
    key: string;
  }
  interface HTMLAttributes<T = Element> {
    children?: ReactNode;
    className?: string;
    id?: string;
    style?: CSSProperties;
    key?: Key;
    ref?: Ref<T>;
    [attributeName: string]: any;
  }
  interface SVGProps<T = Element> extends HTMLAttributes<T> {}

  const Fragment: any;
  function createElement(...args: any[]): any;
  function cloneElement(...args: any[]): any;
  function createContext(defaultValue?: any): any;
  function useState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
  function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  function useMemo<T>(factory: () => T, deps?: readonly any[]): T;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly any[]): T;
  function useRef<T>(initialValue: T): MutableRefObject<T>;
  function useRef<T = any>(initialValue?: T): MutableRefObject<T | undefined>;
  function useContext(context: any): any;
  function memo<T>(component: T): T;
  function forwardRef(render: any): any;
}

declare module "react" {
  const React: any;
  export default React;

  export type ReactNode = any;
  export type ReactElement = any;
  export type CSSProperties = Record<string, string | number>;
  export type SetStateAction<T> = T | ((previous: T) => T);
  export type Dispatch<T> = (value: T) => void;
  export type FC<P = {}> = (props: P) => ReactElement | null;
  export type FunctionComponent<P = {}> = FC<P>;
  export type ComponentType<P = {}> = any;
  export type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  export type ChangeEvent<T = Element> = { target: T; currentTarget: T };
  export type FormEvent<T = Element> = { preventDefault(): void; target: T; currentTarget: T };
  export type MouseEvent<T = Element> = { preventDefault(): void; stopPropagation(): void; target: T; currentTarget: T };

  export const Fragment: any;
  export function createElement(...args: any[]): any;
  export function cloneElement(...args: any[]): any;
  export function createContext(defaultValue?: any): any;
  export function useState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly any[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export function useRef<T = any>(initialValue?: T): { current: T | undefined };
  export function useContext(context: any): any;
  export function memo<T>(component: T): T;
  export function forwardRef(render: any): any;
}

declare module "react/jsx-runtime" {
  export namespace JSX {
    type Element = any;
    interface IntrinsicAttributes {
      key?: any;
    }
    interface IntrinsicClassAttributes<T> {
      ref?: any;
    }
    interface IntrinsicElements {
      [elementName: string]: any;
    }
  }

  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): JSX.Element;
  export function jsxs(type: any, props: any, key?: any): JSX.Element;
}

declare module "react/jsx-dev-runtime" {
  export namespace JSX {
    type Element = any;
    interface IntrinsicAttributes {
      key?: any;
    }
    interface IntrinsicClassAttributes<T> {
      ref?: any;
    }
    interface IntrinsicElements {
      [elementName: string]: any;
    }
  }

  export const Fragment: any;
  export function jsxDEV(type: any, props: any, key?: any): JSX.Element;
}
`;

const isImageFile = (file?: ProjectFile) =>
  Boolean(file && (file.kind === "image" || IMAGE_EXTENSIONS.has(file.extension)));

const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const emptySelection: EditorSelection = {
  text: "",
  lineCount: 0,
  cursorLine: 1,
  cursorLineText: "",
};

const getLanguage = (fileName?: string) => {
  if (!fileName) return "typescript";
  if (fileName.endsWith(".gd")) return "gdscript";
  if (fileName.endsWith(".gdshader") || fileName.endsWith(".shader")) return "glsl";
  if (
    fileName.endsWith(".tscn") ||
    fileName.endsWith(".tres") ||
    fileName.endsWith(".godot") ||
    fileName.endsWith(".cfg") ||
    fileName.endsWith(".ini") ||
    fileName.endsWith(".import") ||
    fileName.endsWith(".gdextension")
  ) {
    return "ini";
  }
  if (fileName.endsWith(".cs")) return "csharp";
  if (fileName.endsWith(".tsx") || fileName.endsWith(".ts")) return "typescript";
  if (fileName.endsWith(".jsx") || fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return "javascript";
  }
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".css") || fileName.endsWith(".scss")) return "css";
  if (fileName.endsWith(".html")) return "html";
  if (fileName.endsWith(".md")) return "markdown";
  if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "yaml";
  return "typescript";
};

const supportsTypeScriptWorker = (fileName: string) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(fileName);

const registerGdscriptLanguage = (monaco: Monaco) => {
  const alreadyRegistered = monaco.languages
    .getLanguages()
    .some((language: { id: string }) => language.id === "gdscript");

  if (alreadyRegistered) return;

  monaco.languages.register({
    id: "gdscript",
    extensions: [".gd"],
    aliases: ["GDScript", "gdscript"],
  });

  monaco.languages.setLanguageConfiguration("gdscript", {
    comments: {
      lineComment: "#",
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern:
        /^\s*(func|if|elif|else|for|while|match|class|class_name|try|except|finally)\b.*:\s*$/,
      decreaseIndentPattern: /^\s*(elif|else|except|finally)\b.*:\s*$/,
    },
  });

  monaco.languages.setMonarchTokensProvider("gdscript", {
    defaultToken: "",
    tokenPostfix: ".gd",
    keywords: [
      "and",
      "as",
      "assert",
      "await",
      "break",
      "breakpoint",
      "class",
      "class_name",
      "const",
      "continue",
      "elif",
      "else",
      "enum",
      "extends",
      "for",
      "func",
      "if",
      "in",
      "is",
      "match",
      "not",
      "or",
      "pass",
      "return",
      "self",
      "signal",
      "static",
      "super",
      "var",
      "void",
      "while",
    ],
    builtins: [
      "Array",
      "Basis",
      "Callable",
      "Color",
      "Dictionary",
      "Input",
      "Node",
      "Node2D",
      "Node3D",
      "PackedScene",
      "Quaternion",
      "Resource",
      "SceneTree",
      "Signal",
      "StringName",
      "Transform2D",
      "Transform3D",
      "Vector2",
      "Vector2i",
      "Vector3",
      "Vector3i",
    ],
    operators: [
      "=",
      ">",
      "<",
      "!",
      "~",
      "?",
      ":",
      "==",
      "<=",
      ">=",
      "!=",
      "&&",
      "||",
      "+",
      "-",
      "*",
      "/",
      "%",
    ],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/@[A-Za-z_][\w]*/, "annotation"],
        [/[A-Z][A-Za-z0-9_]*/, "type.identifier"],
        [/[a-zA-Z_]\w*(?=\s*\()/, "function"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@builtins": "type",
              "@default": "identifier",
            },
          },
        ],
        [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
        [/0x[0-9a-fA-F]+/, "number.hex"],
        [/\d+/, "number"],
        [/[{}()[\]]/, "@brackets"],
        [/[=><!~?:&|+\-*/%^]+/, "operator"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, "string", "@string_single"],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider("gdscript", {
    provideCompletionItems: () => ({
      suggestions: [
        "func _ready() -> void:\n\t",
        "func _process(delta: float) -> void:\n\t",
        "func _physics_process(delta: float) -> void:\n\t",
        "@export var ",
        "@onready var ",
        "signal ",
        "preload(\"res://\")",
      ].map((label) => ({
        label: label.split("\n")[0],
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: label,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      })),
    }),
  });
};

const toModelUri = (fileName: string) => {
  const normalized = fileName.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${MONACO_WORKSPACE_ROOT}/${normalized
    .split("/")
    .map(encodeURIComponent)
    .join("/")
    .replace(/%40/g, "@")}`;
};

const enumMember = (
  enumObject: Record<string, unknown>,
  names: string[],
  fallback: unknown
) => names.map((name) => enumObject[name]).find((value) => value !== undefined) ?? fallback;

const getOptionText = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : "";

const toCompilerBaseUrl = (baseUrl: string) => {
  if (!baseUrl || baseUrl === ".") return MONACO_WORKSPACE_ROOT;
  return toModelUri(baseUrl);
};

const createCompilerOptions = (
  monaco: Monaco,
  projectCompilerOptions: Record<string, unknown> = {}
) => {
  const ts = monaco.languages.typescript;
  const compilerOptions: Record<string, unknown> = {
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    checkJs: false,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    noImplicitAny: false,
    resolveJsonModule: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
  };

  [
    "allowJs",
    "allowSyntheticDefaultImports",
    "checkJs",
    "esModuleInterop",
    "noImplicitAny",
    "resolveJsonModule",
    "strict",
  ].forEach((key) => {
    if (typeof projectCompilerOptions[key] === "boolean") {
      compilerOptions[key] = projectCompilerOptions[key];
    }
  });

  const jsx = getOptionText(projectCompilerOptions.jsx);
  if (jsx) {
    compilerOptions.jsx = enumMember(
      ts.JsxEmit as unknown as Record<string, unknown>,
      {
        preserve: ["Preserve"],
        react: ["React"],
        "react-jsx": ["ReactJSX"],
        "react-jsxdev": ["ReactJSXDev"],
        "react-native": ["ReactNative"],
      }[jsx] || ["ReactJSX"],
      ts.JsxEmit.ReactJSX
    );
  }

  const module = getOptionText(projectCompilerOptions.module);
  if (module) {
    compilerOptions.module = enumMember(
      ts.ModuleKind as unknown as Record<string, unknown>,
      {
        commonjs: ["CommonJS"],
        es2015: ["ES2015"],
        es2020: ["ES2020"],
        es2022: ["ES2022"],
        esnext: ["ESNext"],
        node16: ["Node16"],
        nodenext: ["NodeNext"],
      }[module] || ["ESNext"],
      ts.ModuleKind.ESNext
    );
  }

  const moduleResolution = getOptionText(projectCompilerOptions.moduleResolution);
  if (moduleResolution) {
    compilerOptions.moduleResolution = enumMember(
      ts.ModuleResolutionKind as unknown as Record<string, unknown>,
      {
        bundler: ["Bundler", "NodeJs"],
        node: ["NodeJs"],
        node10: ["NodeJs"],
        node16: ["Node16", "NodeJs"],
        nodenext: ["NodeNext", "NodeJs"],
      }[moduleResolution] || ["NodeJs"],
      ts.ModuleResolutionKind.NodeJs
    );
  }

  const target = getOptionText(projectCompilerOptions.target);
  if (target) {
    compilerOptions.target = enumMember(
      ts.ScriptTarget as unknown as Record<string, unknown>,
      {
        es5: ["ES5"],
        es6: ["ES2015"],
        es2015: ["ES2015"],
        es2016: ["ES2016"],
        es2017: ["ES2017"],
        es2018: ["ES2018"],
        es2019: ["ES2019"],
        es2020: ["ES2020"],
        es2021: ["ES2021"],
        es2022: ["ES2022"],
        esnext: ["ESNext"],
      }[target] || ["ES2022"],
      ts.ScriptTarget.ES2022
    );
  }

  if (typeof projectCompilerOptions.baseUrl === "string") {
    compilerOptions.baseUrl = toCompilerBaseUrl(projectCompilerOptions.baseUrl);
  } else {
    compilerOptions.baseUrl = MONACO_WORKSPACE_ROOT;
  }

  if (
    projectCompilerOptions.paths &&
    typeof projectCompilerOptions.paths === "object" &&
    !Array.isArray(projectCompilerOptions.paths)
  ) {
    compilerOptions.paths = projectCompilerOptions.paths;
  }

  if (Array.isArray(projectCompilerOptions.types)) {
    compilerOptions.types = projectCompilerOptions.types;
  }

  if (Array.isArray(projectCompilerOptions.typeRoots)) {
    compilerOptions.typeRoots = projectCompilerOptions.typeRoots.map((typeRoot) =>
      typeof typeRoot === "string" ? toCompilerBaseUrl(typeRoot) : typeRoot
    );
  }

  return compilerOptions;
};

const configureTypeScriptWorker = (
  monaco: Monaco,
  projectCompilerOptions: Record<string, unknown> = {}
) => {
  const compilerOptions = createCompilerOptions(monaco, projectCompilerOptions);
  const diagnosticsOptions = {
    diagnosticCodesToIgnore: MODULE_DIAGNOSTICS_TO_IGNORE,
    noSemanticValidation: false,
    noSyntaxValidation: false,
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
};

const installAmbientTypeShims = (
  monaco: Monaco,
  projectTypeInfo: ProjectTypeInfo,
  activeFile: ProjectFile | undefined,
  disposables: Array<{ dispose: () => void }>
) => {
  disposables.forEach((disposable) => disposable.dispose());
  disposables.length = 0;

  const hasReactTypes = projectTypeInfo.typeLibs.some(
    (typeLib) =>
      typeLib.packageName === "@types/react" ||
      typeLib.packageName === "react" ||
      typeLib.filePath.includes("node_modules/@types/react/") ||
      typeLib.filePath.includes("node_modules/react/")
  );
  const projectUsesReact =
    Boolean(activeFile?.path.match(/\.(tsx|jsx)$/i)) ||
    projectTypeInfo.packageNames.includes("react") ||
    projectTypeInfo.packageNames.includes("@types/react");

  if (!projectUsesReact || hasReactTypes) return;

  const reactTypesUri = `${MONACO_WORKSPACE_ROOT}/node_modules/@types/react/index.d.ts`;
  disposables.push(
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      REACT_AMBIENT_TYPES,
      reactTypesUri
    ),
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      REACT_AMBIENT_TYPES,
      reactTypesUri
    )
  );
};

const syncProjectTypeLibs = (
  monaco: Monaco,
  projectTypeInfo: ProjectTypeInfo,
  disposables: Array<{ dispose: () => void }>
) => {
  disposables.forEach((disposable) => disposable.dispose());
  disposables.length = 0;

  projectTypeInfo.typeLibs.forEach((typeLib) => {
    const uri = toModelUri(typeLib.filePath);
    disposables.push(
      monaco.languages.typescript.typescriptDefaults.addExtraLib(typeLib.content, uri),
      monaco.languages.typescript.javascriptDefaults.addExtraLib(typeLib.content, uri)
    );
  });
};

const syncProjectExtraLibs = (
  monaco: Monaco,
  projectFiles: Record<string, string>,
  disposables: Array<{ dispose: () => void }>
) => {
  disposables.forEach((disposable) => disposable.dispose());
  disposables.length = 0;

  Object.entries(projectFiles)
    .filter(([fileName]) => supportsTypeScriptWorker(fileName))
    .forEach(([fileName, text]) => {
      const uri = toModelUri(fileName);
      disposables.push(
        monaco.languages.typescript.typescriptDefaults.addExtraLib(text, uri),
        monaco.languages.typescript.javascriptDefaults.addExtraLib(text, uri)
      );
    });
};

const getSelectionFromEditor = (
  editor: EditorReader,
  preferCurrentLine = false
): EditorSelection => {
  const model = editor.getModel();
  const selection = editor.getSelection();
  const cursor = editor.getPosition();

  if (!model || !cursor) return emptySelection;

  const cursorLineText = model.getLineContent(cursor.lineNumber);

  if (!selection || selection.isEmpty()) {
    if (!preferCurrentLine) {
      return {
        text: "",
        lineCount: 0,
        cursorLine: cursor.lineNumber,
        cursorLineText,
      };
    }

    return {
      text: cursorLineText,
      lineCount: 1,
      cursorLine: cursor.lineNumber,
      cursorLineText,
      range: {
        startLineNumber: cursor.lineNumber,
        startColumn: 1,
        endLineNumber: cursor.lineNumber,
        endColumn: cursorLineText.length + 1,
      },
    };
  }

  return {
    text: model.getValueInRange(selection),
    lineCount: selection.endLineNumber - selection.startLineNumber + 1,
    cursorLine: cursor.lineNumber,
    cursorLineText,
    range: {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    },
  };
};

const getInsertionSelectionFromEditor = (editor: EditorReader): EditorSelection => {
  const model = editor.getModel();
  const selection = editor.getSelection();
  const cursor = editor.getPosition();

  if (!model || !cursor) return emptySelection;

  const cursorLineText = model.getLineContent(cursor.lineNumber);

  if (selection && !selection.isEmpty()) {
    return getSelectionFromEditor(editor);
  }

  return {
    text: "",
    lineCount: 0,
    cursorLine: cursor.lineNumber,
    cursorLineText,
    range: {
      startLineNumber: cursor.lineNumber,
      startColumn: cursor.column,
      endLineNumber: cursor.lineNumber,
      endColumn: cursor.column,
    },
  };
};

export function EditorPanel({
  activeFile,
  content,
  isDirty,
  isSaving,
  inlineState,
  projectFiles,
  projectTypeInfo,
  onApplyInline,
  onContentChange,
  onDebugSelection,
  onDismissInline,
  onExplainSelection,
  onGenerateRequest,
  onInlineRequest,
  onSave,
  onSelectionChange,
}: EditorPanelProps) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const ambientLibDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const extraLibDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const projectTypeLibDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const [isInlineOpen, setIsInlineOpen] = useState(false);
  const [aiMode, setAiMode] = useState<"generate" | "edit">("edit");
  const [inlineInstruction, setInlineInstruction] = useState("");
  const isImageAsset = isImageFile(activeFile);
  const canEditText = Boolean(activeFile && !isImageAsset);

  useEffect(() => {
    setIsInlineOpen(false);
    setInlineInstruction("");
  }, [activeFile?.path]);

  useEffect(() => {
    return () => {
      ambientLibDisposablesRef.current.forEach((disposable) => disposable.dispose());
      extraLibDisposablesRef.current.forEach((disposable) => disposable.dispose());
      projectTypeLibDisposablesRef.current.forEach((disposable) => disposable.dispose());
      ambientLibDisposablesRef.current = [];
      extraLibDisposablesRef.current = [];
      projectTypeLibDisposablesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    configureTypeScriptWorker(monaco, projectTypeInfo.compilerOptions);
  }, [projectTypeInfo.compilerOptions]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    syncProjectTypeLibs(monaco, projectTypeInfo, projectTypeLibDisposablesRef.current);
    installAmbientTypeShims(
      monaco,
      projectTypeInfo,
      activeFile,
      ambientLibDisposablesRef.current
    );

    return () => {
      projectTypeLibDisposablesRef.current.forEach((disposable) => disposable.dispose());
      projectTypeLibDisposablesRef.current = [];
    };
  }, [activeFile, projectTypeInfo]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    syncProjectExtraLibs(monaco, projectFiles, extraLibDisposablesRef.current);

    return () => {
      extraLibDisposablesRef.current.forEach((disposable) => disposable.dispose());
      extraLibDisposablesRef.current = [];
    };
  }, [projectFiles]);

  const readCurrentSelection = (preferCurrentLine = false) => {
    if (!editorRef.current) return emptySelection;
    return getSelectionFromEditor(editorRef.current, preferCurrentLine);
  };

  const readInsertionSelection = () => {
    if (!editorRef.current) return emptySelection;
    return getInsertionSelectionFromEditor(editorRef.current);
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;

    editor.onDidChangeCursorSelection(() => {
      onSelectionChange(getSelectionFromEditor(editor));
    });

    editor.addAction({
      id: "local-ai-explain-selection",
      label: "Explain this",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: (currentEditor) => {
        const selection = getSelectionFromEditor(currentEditor);
        if (selection.text.trim()) onExplainSelection(selection);
      },
    });

    editor.addAction({
      id: "godot-ai-edit-selection",
      label: "Edit with Godot AI",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 2,
      run: (currentEditor) => {
        onSelectionChange(getSelectionFromEditor(currentEditor, true));
        setAiMode("edit");
        setIsInlineOpen(true);
      },
    });

    editor.addAction({
      id: "godot-ai-generate-code",
      label: "Generate GDScript here",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 3,
      run: (currentEditor) => {
        onSelectionChange(getInsertionSelectionFromEditor(currentEditor));
        setAiMode("generate");
        setIsInlineOpen(true);
      },
    });
  };

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    registerGdscriptLanguage(monaco);
    configureTypeScriptWorker(monaco, projectTypeInfo.compilerOptions);
    syncProjectTypeLibs(monaco, projectTypeInfo, projectTypeLibDisposablesRef.current);
    installAmbientTypeShims(
      monaco,
      projectTypeInfo,
      activeFile,
      ambientLibDisposablesRef.current
    );
    syncProjectExtraLibs(monaco, projectFiles, extraLibDisposablesRef.current);
  };

  const handleExplainClick = () => {
    const selection = readCurrentSelection(true);
    if (selection.text.trim()) onExplainSelection(selection);
  };

  const handleDebugClick = () => {
    const selection = readCurrentSelection(true);
    if (selection.text.trim()) onDebugSelection(selection);
  };

  const openAiBar = (mode: "generate" | "edit") => {
    setAiMode(mode);
    setIsInlineOpen(true);
  };

  const handleInlineSubmit = () => {
    const selection =
      aiMode === "generate" ? readInsertionSelection() : readCurrentSelection(true);
    if (!inlineInstruction.trim()) return;

    onSelectionChange(selection);
    if (aiMode === "generate") {
      onGenerateRequest(selection, inlineInstruction.trim());
    } else {
      onInlineRequest(selection, inlineInstruction.trim());
    }
  };

  const handleInlineDismiss = () => {
    setIsInlineOpen(false);
    setInlineInstruction("");
    onDismissInline();
  };

  return (
    <section className="panel editor-panel">
      <div className="panel-header editor-header">
        <div>
          <h2>
            {activeFile?.name || "Editor"}
            {isDirty && canEditText ? " *" : ""}
          </h2>
          <span>{activeFile?.path || "No file selected"}</span>
        </div>
        <div className="editor-actions">
          <button
            className="icon-button compact-icon"
            disabled={!canEditText || isSaving}
            onClick={onSave}
            title="Save"
            type="button"
          >
            {isSaving ? <SyncRounded className="spin" /> : <SaveRounded />}
          </button>
          <button
            className="icon-button compact-icon"
            disabled={!canEditText}
            onClick={() => openAiBar("generate")}
            title="Generate GDScript"
            type="button"
          >
            <DataObjectRounded />
          </button>
          <button
            className="icon-button compact-icon"
            disabled={!canEditText}
            onClick={handleExplainClick}
            title="Explain this"
            type="button"
          >
            <ForumRounded />
          </button>
          <button
            className="icon-button compact-icon"
            disabled={!canEditText}
            onClick={() => openAiBar("edit")}
            title="Edit selected code"
            type="button"
          >
            <AutoFixHighRounded />
          </button>
          <button
            className="icon-button compact-icon"
            disabled={!canEditText}
            onClick={handleDebugClick}
            title="Debug selected code"
            type="button"
          >
            <BugReportRounded />
          </button>
        </div>
      </div>

      {isInlineOpen && canEditText ? (
        <div className="inline-ai-bar">
          <div className="inline-mode-row" role="tablist" aria-label="AI code action">
            <button
              className={`mode-chip ${aiMode === "generate" ? "active" : ""}`}
              onClick={() => setAiMode("generate")}
              type="button"
            >
              <DataObjectRounded />
              <span>Generate</span>
            </button>
            <button
              className={`mode-chip ${aiMode === "edit" ? "active" : ""}`}
              onClick={() => setAiMode("edit")}
              type="button"
            >
              <AutoFixHighRounded />
              <span>Edit</span>
            </button>
          </div>
          <div className="inline-input-row">
            <input
              disabled={inlineState.isLoading}
              onChange={(event) => setInlineInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleInlineSubmit();
                if (event.key === "Escape") handleInlineDismiss();
              }}
              placeholder={
                aiMode === "generate"
                  ? "Describe GDScript to insert at the cursor..."
                  : "Rewrite, refactor, type, or fix the selection..."
              }
              value={inlineInstruction}
            />
            <button
              className="icon-button compact-icon"
              disabled={!inlineInstruction.trim() || inlineState.isLoading}
              onClick={handleInlineSubmit}
              title="Run inline AI"
              type="button"
            >
              {inlineState.isLoading ? (
                <SyncRounded className="spin" />
              ) : (
                <AutoFixHighRounded />
              )}
            </button>
            <button
              className="icon-button compact-icon"
              onClick={handleInlineDismiss}
              title="Close"
              type="button"
            >
              <CloseRounded />
            </button>
          </div>
          {inlineState.error ? <div className="inline-error">{inlineState.error}</div> : null}
          {inlineState.suggestion ? (
            <div className="inline-suggestion">
              <pre>{inlineState.suggestion}</pre>
              <button
                className="icon-button compact-icon"
                disabled={inlineState.isLoading}
                onClick={onApplyInline}
                title="Apply"
                type="button"
              >
                <CheckRounded />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="editor-shell">
        {activeFile ? (
          isImageAsset ? (
            <div className="asset-preview">
              <div className="asset-stage">
                {content && activeFile.previewable ? (
                  <img alt={activeFile.name} src={content} />
                ) : (
                  <div className="asset-placeholder">
                    <ImageRounded />
                    <span>Preview unavailable for this Godot image format</span>
                  </div>
                )}
              </div>
              <dl className="asset-meta">
                <div>
                  <dt>Path</dt>
                  <dd>{activeFile.path}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{activeFile.extension || "image"}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(activeFile.size)}</dd>
                </div>
                <div>
                  <dt>Indexed</dt>
                  <dd>Asset metadata only</dd>
                </div>
              </dl>
            </div>
          ) : (
            <Editor
              height="100%"
              language={getLanguage(activeFile.path)}
              beforeMount={handleBeforeMount}
              onChange={(value) => onContentChange(value || "")}
              onMount={handleMount}
              options={{
                readOnly: false,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                wordWrap: "on",
                padding: { top: 14, bottom: 14 },
              }}
              path={toModelUri(activeFile.path)}
              theme="vs-dark"
              value={content}
            />
          )
        ) : (
          <div className="editor-empty">Open a file</div>
        )}
      </div>
    </section>
  );
}
