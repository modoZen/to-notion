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

export interface CourseRegistryEntry {
  pageId: string;
  docxFileName: string; // basename tal cual (ej. "curso-x.docx"), no ruta completa
  docxHash: string; // sha256 hex del contenido del .docx, calculado por el caller
  createdAt: string; // ISO, se fija una sola vez al registrar el slug por primera vez
  lastSyncedAt: string; // ISO, se actualiza en cada upsertCourse
}

// Clave: slug (mismo que slugify() en docx-to-md/modules.ts, y el mismo
// que usa workspace/<slug>/). Persistido en <workspaceRoot>/course-registry.json.
export type CourseRegistry = Record<string, CourseRegistryEntry>;

// Campos que el caller de upsertCourse debe proveer explícitamente;
// createdAt/lastSyncedAt los calcula upsertCourse internamente.
export interface NewCourseEntry {
  pageId: string;
  docxFileName: string;
  docxHash: string;
}

// Properties de transporte para crear/actualizar la fila de un curso en la
// base `Cursos` de Notion. createCourse() las mapea a las properties crudas
// de la API (Título/Área/Plataforma/Estado/Módulos/Archivo origen/Última
// sincronización); nunca toca `Notas`.
export interface CourseProperties {
  titulo: string;
  area: string;
  plataforma: string;
  estado: string;
  modulos: number;
  archivoOrigen: string;
  ultimaSincronizacion: string; // ISO, valor de `date.start`
}
