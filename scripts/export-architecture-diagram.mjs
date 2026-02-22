/**
 * Purpose: Exports technical and plain-language Mermaid architecture diagrams to SVG assets.
 * Inputs: First Mermaid fenced block from each architecture markdown source file.
 * Outputs: Updated `.mmd` and `.svg` files for both technical and readable diagrams.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const diagramTargets = [
  {
    label: "technical architecture",
    sourceMarkdownPath: path.resolve(repoRoot, "docs/architecture/architecture.md"),
    outputMmdPath: path.resolve(repoRoot, "docs/architecture/architecture-diagram.mmd"),
    outputSvgPath: path.resolve(repoRoot, "docs/architecture/architecture-diagram.svg")
  },
  {
    label: "human-readable architecture",
    sourceMarkdownPath: path.resolve(repoRoot, "docs/architecture/architecture-readable.md"),
    outputMmdPath: path.resolve(repoRoot, "docs/architecture/architecture-readable-diagram.mmd"),
    outputSvgPath: path.resolve(repoRoot, "docs/architecture/architecture-readable-diagram.svg")
  }
];

function extractMermaidDiagram(markdown, sourcePath) {
  /**
   * Purpose: Extracts the first Mermaid fenced block from Markdown content.
   * Inputs: Full Markdown document text and source file path label.
   * Outputs: Mermaid graph definition string, or throws if missing.
   */
  const match = markdown.match(/```mermaid\s*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error(`No Mermaid diagram block found in ${sourcePath}.`);
  }

  return match[1].trim() + "\n";
}

function runMermaidCli(inputPath, outputPath) {
  /**
   * Purpose: Renders Mermaid source to SVG using local Mermaid CLI.
   * Inputs: Input .mmd path and output .svg path.
   * Outputs: SVG file on disk, or throws on render failure.
   */
  const result = spawnSync(
    process.platform === "win32" ? "mmdc.cmd" : "mmdc",
    ["-i", inputPath, "-o", outputPath, "-b", "transparent"],
    {
      cwd: repoRoot,
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error("Mermaid SVG export failed.");
  }
}

function exportSingleDiagram(target) {
  /**
   * Purpose: Extracts, writes, and renders one configured diagram target.
   * Inputs: Diagram target config containing source and output paths.
   * Outputs: Writes `.mmd` and `.svg` artifacts for the target.
   */
  const markdown = readFileSync(target.sourceMarkdownPath, "utf8");
  const mermaidGraph = extractMermaidDiagram(markdown, target.sourceMarkdownPath);
  writeFileSync(target.outputMmdPath, mermaidGraph, "utf8");
  runMermaidCli(target.outputMmdPath, target.outputSvgPath);
}

function main() {
  /**
   * Purpose: Coordinates extraction + render for all architecture diagram exports.
   * Inputs: None.
   * Outputs: Updated technical and readable `.mmd`/`.svg` architecture artifacts.
   */
  for (const target of diagramTargets) {
    console.log(`Exporting ${target.label} diagram`);
    exportSingleDiagram(target);
  }
}

main();
