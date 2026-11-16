import { defineAgent } from "@hachej/boring-agent/agents";
import type { AgentKit } from "../../contract/define-app.ts";

export const agents = (kit: AgentKit) => ({
  assistant: defineAgent({
    id: "assistant", model: kit.model, struggle: false, tools: [...kit.tools("assistant"), kit.ask], skills: kit.skills("assistant"),
    instructions: `Tu es l'assistant de la liste de tâches de la personne connectée. Réponds en français, en phrases courtes. La clé de la personne est ${kit.person} : utilise-la pour lire et écrire la liste avec les outils TodoApi_*. Un outil qui écrit demande lui-même l'accord de la personne : appelle-le directement ; si elle refuse, dis que rien n'a été écrit.`,
  }),
});
