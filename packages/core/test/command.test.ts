import { describe, expect } from "bun:test"
import { Cause, Effect } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ReservedNameError, RESERVED_CATALOG_VERSION } from "@opencode-ai/core/operator"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(CommandV2.node))

describe("CommandV2", () => {
  it.effect("applies command transforms and preserves later overrides", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* command.transform((editor) => {
        editor.update("review", (command) => {
          command.template = "First"
          command.description = "Review code"
        })
        editor.update("review", (command) => {
          command.template = "Second"
          command.model = {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          }
        })
      })

      expect(yield* command.get("review")).toEqual(
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      )
      expect(yield* command.list()).toEqual([
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      ])
    }),
  )

  it.effect("rejects reserved operator catalog names on Effect transform update (T042)", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      const exit = yield* Effect.exit(
        command.transform((editor) => {
          editor.update("langlock.status", (cmd) => {
            cmd.template = "should never land"
          })
        }),
      )
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const squashed = Cause.squash(exit.cause)
        expect(squashed).toBeInstanceOf(ReservedNameError)
        if (squashed instanceof ReservedNameError) {
          expect(squashed.code).toBe("reserved_name")
          expect(squashed.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
        }
      }
      expect(yield* command.get("langlock.status")).toBeUndefined()
    }),
  )

  it.effect("allows builtin init/review names", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* command.transform((editor) => {
        editor.update("init", (cmd) => {
          cmd.template = "Init ok"
        })
      })
      expect((yield* command.get("init"))?.template).toBe("Init ok")
    }),
  )
})
