/**
 * Structural validation of a .docx package: enough to catch what makes Word refuse a file after a redline
 * (broken zip, missing or malformed parts, dangling relationships, duplicate revision ids, orphan comments).
 * Every check runs and all issues are collected; nothing here throws.
 */
import type { Document, Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { DocxValidation, DocxValidationIssue } from "./types";
import {
  CONTENT_TYPES_NS,
  descendantsW,
  PACKAGE_RELS_NS,
  PART,
  parseXml,
  R_NS,
  W_NS,
  wAttr,
  walkElements,
  XmlPartError,
} from "./xml-utils";

/** Attributes in the relationships namespace whose value must resolve in document.xml.rels. */
const RELATIONSHIP_ATTRIBUTES = new Set(["id", "embed", "link"]);
const EXTERNAL_TARGET_MODE = "External";
const DOCUMENT_DIRECTORY = "word";

type Issue = DocxValidationIssue;

type Package = {
  readonly zip: JSZip;
  readonly names: ReadonlySet<string>;
};

type ContentTypes = {
  readonly defaults: ReadonlySet<string>;
  readonly overrides: ReadonlySet<string>;
};

function issue(code: Issue["code"], detail: string): Issue {
  return { code, detail };
}

async function openPackage(bytes: Uint8Array): Promise<Package | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const names = new Set(Object.entries(zip.files).flatMap(([name, entry]) => (entry.dir ? [] : [name])));
    return { zip, names };
  } catch {
    return null;
  }
}

async function readPart(pkg: Package, name: string): Promise<string | null> {
  const entry = pkg.zip.file(name);
  return entry ? entry.async("string") : null;
}

/** Parses a part when present; a parse failure becomes an issue and the part is treated as absent. */
async function parsePart(pkg: Package, name: string): Promise<{ doc: Document | null; issues: readonly Issue[] }> {
  const text = await readPart(pkg, name);
  if (text === null) return { doc: null, issues: [] };
  try {
    return { doc: parseXml(text, name), issues: [] };
  } catch (error) {
    const detail = error instanceof XmlPartError ? error.message : `${name}: ${String(error)}`;
    return { doc: null, issues: [issue("xml-not-well-formed", detail)] };
  }
}

function contentTypesOf(doc: Document | null): ContentTypes {
  if (!doc) return { defaults: new Set(), overrides: new Set() };
  const defaults = Array.from(doc.getElementsByTagNameNS(CONTENT_TYPES_NS, "Default")).map((el) =>
    (el.getAttribute("Extension") ?? "").toLowerCase(),
  );
  const overrides = Array.from(doc.getElementsByTagNameNS(CONTENT_TYPES_NS, "Override")).map(
    (el) => el.getAttribute("PartName") ?? "",
  );
  return { defaults: new Set(defaults), overrides: new Set(overrides) };
}

function hasContentType(types: ContentTypes, partName: string): boolean {
  if (types.overrides.has(`/${partName}`)) return true;
  const dot = partName.lastIndexOf(".");
  return dot >= 0 && types.defaults.has(partName.slice(dot + 1).toLowerCase());
}

/** Resolves a relationship Target against the word/ directory, normalising "../" and absolute "/" targets. */
export function resolveTarget(target: string): string {
  const absolute = target.startsWith("/");
  const raw = absolute ? target.slice(1) : `${DOCUMENT_DIRECTORY}/${target}`;
  const parts: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function relationshipsOf(doc: Document | null): readonly Element[] {
  return doc ? Array.from(doc.getElementsByTagNameNS(PACKAGE_RELS_NS, "Relationship")) : [];
}

function checkDanglingReferences(document: Document, rels: readonly Element[]): readonly Issue[] {
  const known = new Set(rels.map((rel) => rel.getAttribute("Id") ?? ""));
  const issues: Issue[] = [];
  walkElements(document, (el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI !== R_NS || !RELATIONSHIP_ATTRIBUTES.has(attr.localName ?? "")) continue;
      if (!known.has(attr.value)) {
        issues.push(
          issue("dangling-relationship", `<${el.tagName} r:${attr.localName}="${attr.value}"> has no relationship`),
        );
      }
    }
  });
  return issues;
}

function checkRelationshipTargets(pkg: Package, rels: readonly Element[], types: ContentTypes): readonly Issue[] {
  return rels.flatMap((rel) => {
    if (rel.getAttribute("TargetMode") === EXTERNAL_TARGET_MODE) return [];
    const id = rel.getAttribute("Id") ?? "";
    const partName = resolveTarget(rel.getAttribute("Target") ?? "");
    if (!pkg.names.has(partName)) return [issue("unregistered-part", `${id} -> ${partName} is not in the package`)];
    if (!hasContentType(types, partName))
      return [issue("unregistered-part", `${id} -> ${partName} has no content type`)];
    return [];
  });
}

function checkRevisionIds(document: Document): readonly Issue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  walkElements(document, (el) => {
    if (el.namespaceURI !== W_NS || (el.localName !== "ins" && el.localName !== "del")) return;
    const id = wAttr(el, "id");
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  return [...duplicates].map((id) =>
    issue("duplicate-revision-id", `w:id="${id}" is used by more than one w:ins/w:del`),
  );
}

function idsOf(root: Document | null, local: string): ReadonlySet<string> {
  return new Set(root ? descendantsW(root, local).map((el) => wAttr(el, "id")) : []);
}

function checkComments(document: Document, comments: Document | null): readonly Issue[] {
  const starts = idsOf(document, "commentRangeStart");
  const ends = idsOf(document, "commentRangeEnd");
  const entries = idsOf(comments, "comment");
  return descendantsW(document, "commentReference").flatMap((reference) => {
    const id = wAttr(reference, "id");
    const missing = [
      starts.has(id) ? null : "commentRangeStart",
      ends.has(id) ? null : "commentRangeEnd",
      entries.has(id) ? null : `entry in ${PART.comments}`,
    ].filter((item): item is string => item !== null);
    return missing.length === 0
      ? []
      : [issue("comment-without-range", `commentReference w:id="${id}" is missing ${missing.join(", ")}`)];
  });
}

async function checkPackage(pkg: Package): Promise<readonly Issue[]> {
  const presence: Issue[] = [];
  if (!pkg.names.has(PART.contentTypes))
    presence.push(issue("missing-content-types", `${PART.contentTypes} is missing`));
  if (!pkg.names.has(PART.document)) presence.push(issue("missing-document", `${PART.document} is missing`));
  const contentTypes = await parsePart(pkg, PART.contentTypes);
  const document = await parsePart(pkg, PART.document);
  const comments = await parsePart(pkg, PART.comments);
  const rootRels = await parsePart(pkg, PART.rootRels);
  const documentRels = await parsePart(pkg, PART.documentRels);
  const parsing = [
    ...contentTypes.issues,
    ...document.issues,
    ...comments.issues,
    ...rootRels.issues,
    ...documentRels.issues,
  ];
  const rels = relationshipsOf(documentRels.doc);
  const types = contentTypesOf(contentTypes.doc);
  const structural = document.doc
    ? [
        ...checkDanglingReferences(document.doc, rels),
        ...checkRelationshipTargets(pkg, rels, types),
        ...checkRevisionIds(document.doc),
        ...checkComments(document.doc, comments.doc),
      ]
    : checkRelationshipTargets(pkg, rels, types);
  return [...presence, ...parsing, ...structural];
}

/** Runs every structural check and reports all findings; `ok` is true only when nothing was found. */
export async function validateDocx(bytes: Uint8Array): Promise<DocxValidation> {
  const pkg = await openPackage(bytes);
  if (!pkg) return { ok: false, issues: [issue("not-a-zip", "bytes are not a zip archive")] };
  const issues = await checkPackage(pkg);
  return { ok: issues.length === 0, issues };
}
