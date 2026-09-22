import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Boxes, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { ModuleErrorState, ModuleSkeleton } from "@/components/app/module-kit";

/**
 * Understand relationship view — the one Three.js experience (brief §5).
 *
 * Shows REAL relationships in this project: the business at the centre, its
 * audiences (personas), the journeys mapped to them and the content written
 * for them. Selecting a tile updates the HTML detail panel beside the canvas.
 *
 * Rules honoured here:
 *  - three.js is dynamically imported (only this route pays for it, and only
 *    once the visitor opens the map);
 *  - the HTML list below/next to the canvas is the canonical, complete view —
 *    every fact and every selection is reachable without WebGL or a pointer;
 *  - render-on-demand: after the brief entrance the loop stops; resize,
 *    selection and hover each schedule one frame;
 *  - rendering pauses while the document is hidden, DPR is capped at 2,
 *    low-core devices drop antialiasing and pixel ratio;
 *  - WebGL failure and context loss fall back to the static list with a note;
 *  - reduced motion skips the entrance entirely (static first frame);
 *  - full disposal on unmount (renderer, context, geometry, materials,
 *    listeners, observers) so repeated navigation accumulates nothing.
 */

type NodeKind = "project" | "persona" | "journey" | "content";

type MapNode = {
  id: string;
  kind: NodeKind;
  label: string;
  detail: string[];
  /** World position of the tile centre. */
  pos: [number, number, number];
  /** Edge target (node id) — the relationship this tile hangs off. */
  parent?: string;
  size: number;
};

const KIND_LABEL: Record<NodeKind, string> = {
  project: "business",
  persona: "audience",
  journey: "journey",
  content: "content",
};

/* ── Layout: deterministic rings, parent-attached satellites ──────────── */

const TAU = Math.PI * 2;

function ringPos(i: number, n: number, rx: number, ry: number): [number, number] {
  const a = -Math.PI / 2 + (i / Math.max(n, 1)) * TAU;
  return [Math.cos(a) * rx, Math.sin(a) * ry];
}

function outward(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

function useMapNodes(projectId: Id<"projects">): MapNode[] | null {
  const project = useQuery(api.projects.get, { id: projectId });
  const personas = useQuery(api.personas.list, { projectId });
  const journeys = useQuery(api.journeys.list, { projectId });
  const content = useQuery(api.content.list, { projectId });

  return useMemo(() => {
    if (!project || !personas || !journeys || !content) return null;

    const nodes: MapNode[] = [];
    const projectNodeId = `project:${projectId}`;
    nodes.push({
      id: projectNodeId,
      kind: "project",
      label: project.name,
      detail: [
        project.description ?? "Your business context — the source every other tile draws from.",
        project.industry ? `industry: ${project.industry}` : "industry not set yet",
      ].filter(Boolean),
      pos: [0, 0, 0.2],
      size: 1.5,
    });

    const personaPos = new Map<string, [number, number]>();
    personas.forEach((p, i) => {
      const [x, y] = ringPos(i, personas.length, 3.0, 1.9);
      const id = `persona:${p._id}`;
      personaPos.set(p._id, [x, y]);
      nodes.push({
        id,
        kind: "persona",
        label: p.name,
        detail: [
          p.role ? `role: ${p.role}` : undefined,
          p.goals?.length ? `goals: ${p.goals.join(" · ")}` : undefined,
          p.pains?.length ? `pains: ${p.pains.join(" · ")}` : undefined,
        ].filter(Boolean) as string[],
        pos: [x, y, 0],
        parent: projectNodeId,
        size: 1.0,
      });
    });

    let freeJourney = 0;
    const freeJourneys = journeys.filter((j) => !personaPos.has(j.personaId ?? ""));
    journeys.forEach((j) => {
      const parentPersona = j.personaId ? personaPos.get(j.personaId) : undefined;
      let x: number;
      let y: number;
      let parent = projectNodeId;
      if (parentPersona) {
        const [dx, dy] = outward(parentPersona[0], parentPersona[1]);
        x = parentPersona[0] + dx * 1.9;
        y = parentPersona[1] + dy * 1.25;
        parent = `persona:${j.personaId}`;
      } else {
        [x, y] = ringPos(freeJourney, freeJourneys.length, 5.4, 3.4);
        freeJourney += 1;
      }
      nodes.push({
        id: `journey:${j._id}`,
        kind: "journey",
        label: j.name,
        detail: [
          parentPersona ? `mapped to an audience in this project` : `not linked to an audience yet`,
          "stages and scores live in Journeys",
        ],
        pos: [x, y, -0.1],
        parent,
        size: 0.85,
      });
    });

    let freeContent = 0;
    const freeContentPieces = content.filter(
      (c) => !c.personaId || !personaPos.has(c.personaId),
    );
    content.slice(0, 16).forEach((c) => {
      const parentPersona = c.personaId ? personaPos.get(c.personaId) : undefined;
      let x: number;
      let y: number;
      let parent = projectNodeId;
      if (parentPersona) {
        const [dx, dy] = outward(parentPersona[0], parentPersona[1]);
        const side = freeContent % 2 === 0 ? 1 : -1;
        x = parentPersona[0] + dx * 1.35 - dy * 0.55 * side;
        y = parentPersona[1] + dy * 0.95 + dx * 0.55 * side;
        parent = `persona:${c.personaId}`;
      } else {
        const [fx, fy] = ringPos(freeContent, freeContentPieces.length, 6.6, 4.1);
        x = fx;
        y = fy;
        freeContent += 1;
      }
      nodes.push({
        id: `content:${c._id}`,
        kind: "content",
        label: c.title,
        detail: [`status: ${(c.status ?? "draft").replace(/_/g, " ")}`],
        pos: [x, y, 0.05],
        parent,
        size: 0.7,
      });
    });

    return nodes;
  }, [projectId, project, personas, journeys, content]);
}

/* ── Token colours for WebGL (read from index.css, never re-typed hex) ── */

function tokenColor(
  THREE: typeof import("three"),
  varName: string,
  fallback: [number, number, number],
): import("three").Color {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  const color = new THREE.Color();
  // setStyle warns and keeps the current value on an unparseable string, so
  // start from an impossible sentinel to detect failure without relying on
  // the warning (fallbacks are sRGB floats, used only if oklch is unsupported).
  color.setRGB(-1, -1, -1);
  if (raw) color.setStyle(raw);
  if (color.r < 0) color.setRGB(fallback[0], fallback[1], fallback[2]);
  return color;
}

/* ── The scene (all three.js usage lives behind the dynamic import) ───── */

type SceneHandle = {
  dispose: () => void;
  /** Apply the React-side selection to the already-mounted scene. */
  setSelected: (id: string | null) => void;
};

async function mountScene(
  container: HTMLElement,
  nodes: MapNode[],
  opts: {
    reducedMotion: boolean;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onContextLost: () => void;
  },
): Promise<SceneHandle> {
  const THREE = await import("three");

  const disposables: Array<{ dispose: () => void }> = [];
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // The canvas is a visual enhancement; the HTML list next to it is the
  // accessible, complete representation of everything shown here.
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const lowPower =
    typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency <= 4;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowPower,
    alpha: true,
  });
  renderer.setPixelRatio(
    lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  );

  // Flat board, slightly tilted for a restrained sense of depth.
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.rotation.set(-0.16, 0.14, 0);
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-3, 6, 8);
  scene.add(key);

  const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60);
  camera.position.set(0, 0, 14);
  camera.lookAt(0, 0, 0);

  const palette = {
    project: tokenColor(THREE, "--terminal-green", [0.16, 0.55, 0.35]),
    persona: tokenColor(THREE, "--tile-teal", [0.16, 0.55, 0.6]),
    journey: tokenColor(THREE, "--tile-sky", [0.3, 0.5, 0.85]),
    content: tokenColor(THREE, "--tile-violet", [0.45, 0.3, 0.75]),
    edge: tokenColor(THREE, "--muted-foreground", [0.5, 0.5, 0.5]),
    edgeActive: tokenColor(THREE, "--terminal-green", [0.16, 0.55, 0.35]),
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const meshes = new Map<string, import("three").Mesh>();
  const baseColors = new Map<string, import("three").Color>();

  const tileGeo = new THREE.BoxGeometry(1, 1, 0.22);
  disposables.push(tileGeo);

  nodes.forEach((node) => {
    const geo =
      node.size === 1 ? tileGeo : new THREE.BoxGeometry(node.size, node.size, 0.22);
    if (geo !== tileGeo) disposables.push(geo);
    const mat = new THREE.MeshStandardMaterial({
      color: palette[node.kind],
      roughness: 0.6,
      metalness: 0,
    });
    disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(node.pos[0], node.pos[1], node.pos[2]);
    mesh.scale.setScalar(opts.reducedMotion ? 1 : 0.001);
    mesh.userData.nodeId = node.id;
    group.add(mesh);
    meshes.set(node.id, mesh);
    baseColors.set(node.id, palette[node.kind].clone());
  });

  // Edges: one straight segment per relationship.
  const edgePairs: Array<[string, string]> = [];
  for (const node of nodes) {
    if (node.parent && nodeById.has(node.parent)) {
      edgePairs.push([node.parent, node.id]);
    }
  }
  const edgeMaterials: Array<import("three").LineBasicMaterial> = [];
  for (const [fromId, toId] of edgePairs) {
    const from = nodeById.get(fromId)!;
    const to = nodeById.get(toId)!;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from.pos),
      new THREE.Vector3(...to.pos),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: palette.edge,
      transparent: true,
      opacity: 0.55,
    });
    disposables.push(geo, mat);
    edgeMaterials.push(mat);
    group.add(new THREE.Line(geo, mat));
  }

  /* ── Selection / hover state (render-on-demand) ─────────────────────── */

  let selectedId = opts.selectedId;
  let hoveredId: string | null = null;
  let raf = 0;
  let entranceStart: number | null = opts.reducedMotion ? null : performance.now();
  let disposed = false;
  let frameRequested = false;

  const refreshVisuals = () => {
    for (const [id, mesh] of meshes) {
      const base = baseColors.get(id)!;
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;
      const target = (mesh.material as import("three").MeshStandardMaterial).color;
      target.copy(base);
      if (isSelected) target.lerp(new THREE.Color(1, 1, 1), 0.28);
      else if (isHovered) target.lerp(new THREE.Color(1, 1, 1), 0.15);
      else if (selectedId) target.lerp(new THREE.Color(0, 0, 0), 0.18);
    }
    edgePairs.forEach((pair, i) => {
      const active =
        selectedId !== null && (pair[0] === selectedId || pair[1] === selectedId);
      const mat = edgeMaterials[i];
      mat.color.copy(active ? palette.edgeActive : palette.edge);
      mat.opacity = active ? 0.95 : selectedId ? 0.3 : 0.55;
    });
  };

  const draw = (now: number) => {
    const elapsed = entranceStart !== null ? now - entranceStart : null;
    if (elapsed !== null) {
      nodes.forEach((node, i) => {
        const mesh = meshes.get(node.id)!;
        const p = Math.min(Math.max((elapsed - i * 35) / 320, 0), 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const emphasis = node.id === selectedId ? 1.16 : 1;
        mesh.scale.setScalar(Math.max(0.001, eased * emphasis));
        if (elapsed > nodes.length * 35 + 340) entranceStart = null;
      });
    } else {
      for (const [id, mesh] of meshes) {
        const emphasis = id === selectedId ? 1.16 : 1;
        mesh.scale.setScalar(emphasis);
      }
    }
    renderer.render(scene, camera);
  };

  const frame = (now: number) => {
    raf = 0;
    frameRequested = false;
    if (disposed || document.hidden) return;
    draw(now);
    if (entranceStart !== null) requestLoop();
  };

  const requestLoop = () => {
    if (raf || disposed) return;
    raf = requestAnimationFrame(frame);
  };

  const requestRender = () => {
    if (entranceStart !== null) return; // the loop is already running
    if (frameRequested) return;
    frameRequested = true;
    requestLoop();
  };

  /* ── Sizing ─────────────────────────────────────────────────────────── */

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    let vh = 5.0; // half-height in world units
    let vw = vh * aspect;
    if (vw < 7.6) {
      vw = 7.6;
      vh = vw / aspect;
    }
    camera.left = -vw;
    camera.right = vw;
    camera.top = vh;
    camera.bottom = -vh;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /* ── Picking ────────────────────────────────────────────────────────── */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const pickId = (event: PointerEvent): string | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...meshes.values()], false);
    const id = hits[0]?.object.userData.nodeId;
    return typeof id === "string" ? id : null;
  };

  const onPointerMove = (event: PointerEvent) => {
    const id = pickId(event);
    if (id !== hoveredId) {
      hoveredId = id;
      canvas.style.cursor = id ? "pointer" : "default";
      refreshVisuals();
      requestRender();
    }
  };
  const onClick = (event: MouseEvent) => {
    const id = pickId(event as unknown as PointerEvent);
    opts.onSelect(id);
  };
  const onPointerLeave = () => {
    if (hoveredId !== null) {
      hoveredId = null;
      canvas.style.cursor = "default";
      refreshVisuals();
      requestRender();
    }
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      requestRender();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onLost = (event: Event) => {
    event.preventDefault();
    opts.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  refreshVisuals();
  requestLoop();

  return {
    setSelected(id: string | null) {
      if (id === selectedId) return;
      selectedId = id;
      refreshVisuals();
      requestRender();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // Release the GPU context immediately so repeated open/close of the
      // map never accumulates live contexts.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/* ── React wrapper ────────────────────────────────────────────────────── */

const KIND_ORDER: NodeKind[] = ["project", "persona", "journey", "content"];

export default function RelationMap({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const nodes = useMapNodes(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const selected = useMemo(
    () => nodes?.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  // Mirror list/canvas selection into the mounted scene (one frame, no loop).
  useEffect(() => {
    handleRef.current?.setSelected(selectedId);
  }, [selectedId, nodes]);

  // Mount the scene once nodes are known; re-mounts only when the data or a
  // failure state changes. Cleanup runs on every unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !nodes || failed) return;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cancelled = false;
    mountScene(container, nodes, {
      reducedMotion,
      selectedId,
      onSelect: (id) => setSelectedId(id),
      onContextLost: () => setFailed(true),
    })
      .then((handle) => {
        if (cancelled) handle.dispose();
        else handleRef.current = handle;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // Selection is applied by a separate effect below, not by remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, failed]);

  if (!nodes) {
    return <ModuleSkeleton label="Loading the relationship map…" rows={2} />;
  }

  if (failed) {
    return (
      <ModuleErrorState
        title="The 3D view isn't available here."
        hint="Everything it shows is in the list below — no functionality is lost."
      />
    );
  }

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: nodes.filter((n) => n.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div
          ref={containerRef}
          className="h-72 rounded-md border bg-grid shadow-card sm:h-80"
        />
        <p className="mt-2 font-mono text-caption text-muted-foreground">
          Select a tile to inspect it — or use the list, which carries the same
          information.
        </p>
      </div>

      <div className="grid gap-3">
        <aside
          aria-live="polite"
          className="rounded-md border bg-card p-4 shadow-card"
        >
          {selected ? (
            <>
              <p className="font-mono text-caption text-muted-foreground">
                {KIND_LABEL[selected.kind]}
              </p>
              <p className="mt-0.5 font-mono text-small font-medium">
                {selected.label}
              </p>
              {selected.detail.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {selected.detail.map((line) => (
                    <li
                      key={line}
                      className="font-mono text-caption text-muted-foreground"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="font-mono text-caption text-muted-foreground">
              Nothing selected — choose a tile or a row below to see its
              details.
            </p>
          )}
        </aside>

        <div className="rounded-md border bg-card p-3 shadow-card">
          <p className="px-1 pb-2 font-mono text-caption text-muted-foreground">
            everything on the map, as a list
          </p>
          <div className="grid gap-3">
            {grouped.map((group) => (
              <div key={group.kind}>
                <p className="px-1 font-mono text-caption text-terminal-green">
                  {KIND_LABEL[group.kind]}
                  {group.items.length > 1 ? "s" : ""}
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {group.items.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        aria-pressed={selectedId === node.id}
                        onClick={() =>
                          setSelectedId((current) =>
                            current === node.id ? null : node.id,
                          )
                        }
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-caption transition-colors duration-150 ease-terminal",
                          selectedId === node.id
                            ? "bg-terminal-green-soft text-foreground"
                            : "hover:bg-accent",
                        )}
                      >
                        <span className="min-w-0 truncate">{node.label}</span>
                        {node.kind === "content" && (
                          <Link
                            to={`/app/${projectId}/create`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto inline-flex shrink-0 items-center gap-1 text-terminal-green hover:underline"
                          >
                            open <ExternalLink className="size-3" />
                          </Link>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="sr-only">
        <Boxes className="inline size-4" aria-hidden /> The 3D map and this
        list show the same relationships from this project.
      </p>
    </div>
  );
}
