export interface RichTextAnnotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface RichText {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: RichTextAnnotations;
}

export type NotionBlock =
  | {
      object: "block";
      type: "heading_1";
      heading_1: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "heading_2";
      heading_2: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "heading_3";
      heading_3: { rich_text: RichText[]; is_toggleable: false };
    }
  | {
      object: "block";
      type: "paragraph";
      paragraph: { rich_text: RichText[] };
      _marker?: string;
    }
  | {
      object: "block";
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: RichText[]; children?: NotionBlock[] };
    }
  | {
      object: "block";
      type: "code";
      code: { language: string; rich_text: RichText[] };
    }
  | {
      object: "block";
      type: "callout";
      callout: {
        icon: { type: "emoji"; emoji: string };
        color: string;
        rich_text: RichText[];
      };
    };

export type ImageMode = "callout" | "marker";

export interface MdToBlocksOptions {
  imageMode?: ImageMode; // default: 'callout'
}

export interface MdToBlocksResult {
  blocks: NotionBlock[];
  images: string[]; // tokens de imagen (nombre de archivo) referenciados, en orden de aparición
}
