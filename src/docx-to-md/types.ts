// Unidad intermedia producida por el tokenizer, antes de clasificar.
export type UnitType = "heading" | "list" | "quote" | "image" | "fence" | "para";

export interface Unit {
  type: UnitType;
  level?: number; // solo 'heading'
  text?: string; // solo 'heading'
  src?: string; // solo 'image', ruta al medio extraído por pandoc
  lines?: string[]; // 'list' | 'quote' | 'para' | 'fence'
}

// Resultado del clasificador código-vs-prosa para cada unidad.
export type ClassifiedKind =
  | "code"
  | "prose"
  | "quote"
  | "heading"
  | "image"
  | "list"
  | "fence"
  | "unknown";

export interface ModuleStats {
  code: number;
  images: number;
  headings: number;
  lists: number;
  paras: number;
  quotes: number;
}

// Una entrada de manifest.json por cada módulo (H1) convertido.
export interface ConvertedModule {
  number: number;
  title: string;
  file: string; // relativo al workspace del docx, ej. "modules/01-intro.md"
  images: string[]; // nombres de archivo en media/ referenciados por este módulo
  stats: ModuleStats;
}

export interface Manifest {
  source: string; // nombre de archivo del .docx origen (sin ruta)
  generated: string; // timestamp ISO de la conversión
  modules: ConvertedModule[];
}

// Opciones de entrada para convertir un .docx.
export interface ConvertOptions {
  docxPath: string;
  workspaceRoot?: string; // default: "workspace" en la raíz del proyecto
  only?: number; // convierte solo este número de módulo
  keepIndex?: boolean; // default: false (se detecta y descarta el índice)
}
