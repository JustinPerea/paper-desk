import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArxivHtml } from "../lib/arxiv-html.ts";

export const FIXTURE_IDS = ["2611.27106", "2611.27139", "2611.26897"] as const;
const dir = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const fixtureHtml = (id: string) => readFileSync(`${dir}${id}v1.html`, "utf8");
export const parseFixture = (id: string) => parseArxivHtml(fixtureHtml(id), { arxivId: id, version: "v1" });
export const gold = (name: string) => JSON.parse(readFileSync(`${dir}gold/${name}`, "utf8"));
