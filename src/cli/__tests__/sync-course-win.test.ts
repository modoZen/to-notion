import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));

const { toWslPath } = await import("../sync-course-win.ts");

describe("toWslPath()", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("llama a wslpath -u con la ruta de Windows y devuelve la salida sin el salto de línea final", () => {
    execFileSyncMock.mockReturnValue("/mnt/c/Users/max/curso.docx\n");

    expect(toWslPath("C:\\Users\\max\\curso.docx")).toBe("/mnt/c/Users/max/curso.docx");
    expect(execFileSyncMock).toHaveBeenCalledWith("wslpath", ["-u", "C:\\Users\\max\\curso.docx"], { encoding: "utf8" });
  });
});
