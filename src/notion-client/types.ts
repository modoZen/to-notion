export type HttpMethod = "GET" | "POST" | "PATCH";

export interface NotionRequestExtra {
  headers?: Record<string, string>;
}

export interface ModuleState {
  pageId: string;
  done: boolean;
}

export interface ParentState {
  modules: Record<string, ModuleState>; // clave: String(mod.number)
}

// Persistido en <outDir>/.notion-sync-state.json
export type SyncState = Record<string, ParentState>; // clave: parentId

// Entrada mínima que pushModule necesita del módulo a subir.
export interface PushModuleInput {
  number: number;
  title: string;
}
