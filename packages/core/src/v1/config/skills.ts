export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  autoprime_urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Feature 052: the subset of 'urls' remote skill packs explicitly opted into Tier-2 auto-priming (experimental.skill_autoprime). Never changes 'urls' itself; a pack absent here defaults to NOT opted in.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
