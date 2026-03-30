import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const repoRoot = process.cwd();
const mermaidDiagramTargets = [
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
    },
    {
        label: "business-logic architecture",
        sourceMarkdownPath: path.resolve(repoRoot, "docs/architecture/business-logic.md"),
        outputMmdPath: path.resolve(repoRoot, "docs/architecture/business-logic-diagram.mmd"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/business-logic-diagram.svg")
    }
];
const plantUmlVersion = "1.2025.0";
const plantUmlJarUrl = `https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/${plantUmlVersion}/plantuml-${plantUmlVersion}.jar`;
const plantUmlJarPath = path.resolve(os.tmpdir(), "panel-of-experts-diagram-tools", `plantuml-${plantUmlVersion}.jar`);
const plantUmlTargets = [
    {
        label: "component architecture",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/component-diagram.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/component-diagram.svg"),
        topPaddingPx: 120
    },
    {
        label: "formal component architecture",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/component-diagram-formal.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/component-diagram-formal.svg"),
        topPaddingPx: 120
    },
    {
        label: "detailed component architecture",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/component-diagram-detailed.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/component-diagram-detailed.svg")
    },
    {
        label: "database UML class diagram",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/database-uml-diagram.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/database-uml-diagram.svg"),
        topPaddingPx: 240
    },
    {
        label: "package diagram",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/package-diagram.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/package-diagram.svg"),
        topPaddingPx: 160
    },
    {
        label: "prompt execution sequence diagram",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/prompt-sequence-diagram.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/prompt-sequence-diagram.svg"),
        topPaddingPx: 240
    },
    {
        label: "compact prompt execution sequence diagram",
        sourcePumlPath: path.resolve(repoRoot, "docs/architecture/prompt-sequence-diagram-compact.puml"),
        outputSvgPath: path.resolve(repoRoot, "docs/architecture/prompt-sequence-diagram-compact.svg"),
        topPaddingPx: 180
    }
];
function extractMermaidDiagram(markdown, sourcePath) {
    const match = markdown.match(/```mermaid\s*\n([\s\S]*?)```/);
    if (!match) {
        throw new Error(`No Mermaid diagram block found in ${sourcePath}.`);
    }
    return match[1].trim() + "\n";
}
function runMermaidCli(inputPath, outputPath) {
    const result = spawnSync(process.platform === "win32" ? "mmdc.cmd" : "mmdc", ["-i", inputPath, "-o", outputPath, "-b", "transparent"], {
        cwd: repoRoot,
        stdio: "inherit"
    });
    if (result.status !== 0) {
        throw new Error("Mermaid SVG export failed.");
    }
}
async function ensurePlantUmlJar() {
    if (existsSync(plantUmlJarPath)) {
        return;
    }
    mkdirSync(path.dirname(plantUmlJarPath), { recursive: true });
    const response = await fetch(plantUmlJarUrl);
    if (!response.ok) {
        throw new Error(`Failed to download PlantUML jar from ${plantUmlJarUrl}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(plantUmlJarPath, bytes);
}
function runPlantUmlCli(inputPath) {
    const result = spawnSync("java", ["-jar", plantUmlJarPath, "-tsvg", inputPath], {
        cwd: repoRoot,
        stdio: "inherit"
    });
    if (result.status !== 0) {
        throw new Error("PlantUML SVG export failed.");
    }
}
function addSvgTopPadding(svgText, topPaddingPx) {
    if (!topPaddingPx || topPaddingPx <= 0) {
        return svgText;
    }
    const svgOpenTagMatch = svgText.match(/<svg\b[^>]*>/);
    if (!svgOpenTagMatch) {
        throw new Error("Unable to locate root SVG tag for viewport padding.");
    }
    const svgOpenTag = svgOpenTagMatch[0];
    const heightMatch = svgOpenTag.match(/\bheight="([0-9.]+)px"/);
    const styleMatch = svgOpenTag.match(/\bstyle="([^"]*)"/);
    const viewBoxMatch = svgOpenTag.match(/\bviewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/);
    if (!heightMatch || !styleMatch || !viewBoxMatch) {
        return svgText;
    }
    const currentHeight = Number(heightMatch[1]);
    const currentViewBoxX = Number(viewBoxMatch[1]);
    const currentViewBoxY = Number(viewBoxMatch[2]);
    const currentViewBoxWidth = Number(viewBoxMatch[3]);
    const currentViewBoxHeight = Number(viewBoxMatch[4]);
    const updatedHeight = currentHeight + topPaddingPx;
    const updatedViewBoxY = currentViewBoxY - topPaddingPx;
    const updatedViewBoxHeight = currentViewBoxHeight + topPaddingPx;
    let updatedOpenTag = svgOpenTag.replace(/\bheight="([0-9.]+)px"/, `height="${updatedHeight}px"`);
    const updatedStyle = styleMatch[1].replace(/height:([0-9.]+)px/, `height:${updatedHeight}px`);
    updatedOpenTag = updatedOpenTag.replace(/\bstyle="([^"]*)"/, `style="${updatedStyle}"`);
    updatedOpenTag = updatedOpenTag.replace(/\bviewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/, `viewBox="${currentViewBoxX} ${updatedViewBoxY} ${currentViewBoxWidth} ${updatedViewBoxHeight}"`);
    return svgText.replace(svgOpenTag, updatedOpenTag);
}
function exportSingleMermaidDiagram(target) {
    const markdown = readFileSync(target.sourceMarkdownPath, "utf8");
    const mermaidGraph = extractMermaidDiagram(markdown, target.sourceMarkdownPath);
    writeFileSync(target.outputMmdPath, mermaidGraph, "utf8");
    runMermaidCli(target.outputMmdPath, target.outputSvgPath);
}
async function exportPlantUmlDiagram(target) {
    await ensurePlantUmlJar();
    runPlantUmlCli(target.sourcePumlPath);
    if (!existsSync(target.outputSvgPath)) {
        throw new Error(`Expected PlantUML SVG not found at ${target.outputSvgPath}.`);
    }
    if (target.topPaddingPx) {
        const svgText = readFileSync(target.outputSvgPath, "utf8");
        const paddedSvgText = addSvgTopPadding(svgText, target.topPaddingPx);
        writeFileSync(target.outputSvgPath, paddedSvgText, "utf8");
    }
}
async function main() {
    for (const target of mermaidDiagramTargets) {
        console.log(`Exporting ${target.label} diagram`);
        exportSingleMermaidDiagram(target);
    }
    for (const target of plantUmlTargets) {
        console.log(`Exporting ${target.label} diagram`);
        await exportPlantUmlDiagram(target);
    }
}
await main();
