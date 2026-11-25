import * as cheerio from "cheerio";

export interface Paragraph {
  id: string;
  section_id: string;
  section_title: string;
  text: string;
}
export interface ParsedPaper {
  arxiv_id: string;
  version: string;
  title: string;
  authors_as_printed: string[];
  abstract: Paragraph[];
  sections: { id: string; title: string }[];
  paragraphs: Paragraph[];
  tables: { id: string; caption: string; text: string }[];
  figures: { id: string; caption: string }[];
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Parse arXiv's LaTeXML HTML into addressable paragraphs. The text is untrusted data. */
export function parseArxivHtml(html: string, opts: { arxivId: string; version: string }): ParsedPaper {
  const $ = cheerio.load(html);
  // Drop everything that is not paper body.
  $("script, style, nav, footer, .ltx_page_navbar, .ltx_TOC, .ltx_bibliography, .ltx_page_footer, .modal").remove();
  // Render math as its alttext, so numbers inside math survive.
  $("math").each((_, el) => {
    const alt = $(el).attr("alttext") ?? "";
    $(el).replaceWith($("<span>").text(alt));
  });
  // Drop ltx_tag labels ("1", "Table 2:") from headings only.
  const headingText = (sec: cheerio.Cheerio<any>): string => {
    const h = sec.children("h1,h2,h3,h4,h5,h6").first().clone();
    h.find(".ltx_tag").remove();
    return collapse(h.text());
  };

  const title = collapse($("h1.ltx_title_document").first().text()) || collapse($("title").text());
  const authors_as_printed = $(".ltx_authors .ltx_personname")
    .map((_, el) => collapse($(el).text()))
    .get()
    .filter(Boolean);

  const sections: { id: string; title: string }[] = [];
  $("section[id]").each((_, el) => {
    sections.push({ id: $(el).attr("id")!, title: headingText($(el)) });
  });
  const titleOf = new Map(sections.map((s) => [s.id, s.title]));

  const abstract: Paragraph[] = [];
  $(".ltx_abstract p.ltx_p").each((i, el) => {
    const text = collapse($(el).text());
    if (text) abstract.push({ id: `abstract.p${abstract.length + 1}`, section_id: "abstract", section_title: "Abstract", text });
  });

  const paragraphs: Paragraph[] = [];
  $("div.ltx_para[id]").each((_, el) => {
    const $el = $(el);
    if ($el.parents(".ltx_para, figure, .ltx_abstract, .ltx_bibliography").length) return; // outermost body paragraphs only
    const sec = $el.closest("section[id]");
    const section_id = sec.attr("id") ?? "";
    if (!section_id) return; // LaTeXML leaks preamble junk as top-level paragraphs outside any section
    const text = collapse($el.text());
    if (!text) return;
    paragraphs.push({ id: $el.attr("id")!, section_id, section_title: titleOf.get(section_id) ?? "", text });
  });

  const tables: ParsedPaper["tables"] = [];
  const figures: ParsedPaper["figures"] = [];
  $("figure[id]").each((_, el) => {
    const $el = $(el);
    const caption = collapse($el.children("figcaption").text());
    if ($el.hasClass("ltx_table")) {
      const rows = $el
        .find("tr")
        .map((__, tr) =>
          $(tr)
            .children("td,th")
            .map((___, c) => collapse($(c).text()))
            .get()
            .join(" | "),
        )
        .get();
      tables.push({ id: $el.attr("id")!, caption, text: rows.join("\n") });
    } else {
      figures.push({ id: $el.attr("id")!, caption });
    }
  });

  return { arxiv_id: opts.arxivId, version: opts.version, title, authors_as_printed, abstract, sections, paragraphs, tables, figures };
}
