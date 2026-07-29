/**
 * Deshace TODO el escapado de pandoc. Se usa para (a) clasificar y (b) emitir
 * el contenido de los bloques de código.
 *
 * DEFECTO 5: la clasificación tiene que correr sobre el texto ya desescapado.
 * Pandoc entrega `\<script\>` y `\<` nunca hace match contra `<`.
 * DEFECTO 2: el autoenlace `<https://...>` de pandoc también se limpia acá.
 */
export function unescapeAll(s: string): string {
  let out = s;
  out = stripAutolinks(out);
  out = out.replace(/\\\.\.\./g, "…");
  out = out.replace(/\\(.)/g, "$1");
  return out;
}

/**
 * Versión conservadora para prosa: mantiene el escapado de pandoc (que es
 * markdown válido y preserva **negritas** e *itálicas*), pero limpia los
 * autoenlaces, que sí se ven mal en el resultado y peor en Notion.
 */
export function unescapeProse(s: string): string {
  return (
    stripAutolinks(s)
      .replace(/\\\.\.\./g, "…")
      // Se desescapa todo lo que NO tiene significado en markdown. Quedan
      // escapados `*`, `_`, backtick, `#` y `\`, que sí lo tienen: si se
      // desescapan, la prosa del Word se convierte en formato accidental.
      .replace(/\\([<>"'[\](){}|$~^@+!.,:;=?/&%-])/g, "$1")
      // Word cierra la negrita DESPUÉS del espacio (`**Diferencia **entre`) y
      // markdown no renderiza eso. Se mueve el espacio fuera del marcador.
      .replace(/\*\*(\S(?:[^*]*?\S)?)(\s+)\*\*/g, "**$1**$2")
      .replace(/\*\*(\s+)([^*]*?\S)\*\*/g, "$1**$2**")
      // NBSP: artefacto de Word, no aporta nada en Notion.
      .replace(/\u00a0/g, " ")
  );
}

/** `<https://x>` -> `https://x`  ·  `<mailto:a@b>` -> `a@b` */
export function stripAutolinks(s: string): string {
  return s
    .replace(/\\?<((?:https?|ftp):\/\/[^\s<>]+)\\?>/g, "$1")
    .replace(/\\?<mailto:([^\s<>]+)\\?>/g, "$1");
}

/** ¿La línea es (o empieza como) un autoenlace? DEFECTO 1: no es código. */
export function isAutolinkLine(raw: string): boolean {
  return /^\s*\\?<(?:https?|ftp|mailto):/.test(raw);
}
