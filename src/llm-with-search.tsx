import { Action, ActionPanel, Detail, Form, LaunchProps, Toast, getPreferenceValues, showToast } from "@raycast/api";
import React from "react";
import searchTool from "./tools/search";

type Arguments = {
  query?: string;
};

type Preferences = {
  serperApiKey: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
};

export default function Command(props: LaunchProps<{ arguments?: Arguments }>) {
  const initialQuery = props.arguments?.query ?? "";
  const [query, setQuery] = React.useState(initialQuery);
  const [useWeb, setUseWeb] = React.useState(true);
  const [isRunning, setIsRunning] = React.useState(false);
  const [answer, setAnswer] = React.useState<string>("");
  const [context, setContext] = React.useState<string>("");

  async function run() {
    if (isRunning) return;
    if (!query.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Enter a question" });
      return;
    }
    // Fetch web context first; if no AI access, fall back to showing sources only
    setIsRunning(true);

    try {
      let webContext = "";
      if (useWeb) {
        try {
          const resultsJson = await searchTool(query);
          const results = JSON.parse(resultsJson) as Array<{
            title?: string;
            link?: string;
            snippet?: string;
          }>;
          webContext = results
            .slice(0, 6)
            .map((r, i) => `- (${i + 1}) ${r.title}\n  ${r.link}\n  ${r.snippet}`)
            .join("\n");
        } catch {
          // Continue without web context on error
        }
      }

      const system = [
        "You are Llama 3.2 with web-search augmentation.",
        "Cite sources with [n] references if web context is present.",
        "Prefer concise, accurate answers.",
      ].join("\n");

      const promptParts = [
        system,
        webContext ? `\nWeb results (use as context; cite as [n]):\n${webContext}\n` : "",
        `User question: ${query}`,
      ];

      // Call local Ollama
      const { ollamaBaseUrl = "http://localhost:11434", ollamaModel = "llama3.2:latest" } =
        getPreferenceValues<Preferences>();
      const res = await fetch(`${ollamaBaseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: promptParts.join("\n\n"),
          stream: false,
          options: { temperature: 0.2 },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Ollama error ${res.status}: ${txt}`);
      }
      const json = (await res.json()) as { response?: string };
      setAnswer((json.response ?? "").trim());
      setContext(webContext);
    } catch (error: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "Failed", message: `${error}` });
    } finally {
      setIsRunning(false);
    }
  }

  if (answer) {
    return (
      <AnswerDetail
        answer={answer}
        context={context}
        onAskAnother={() => {
          setAnswer("");
          setContext("");
        }}
      />
    );
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title={isRunning ? "Running…" : "Ask Llama"} onSubmit={run} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="query" title="Question" placeholder="Ask anything..." value={query} onChange={setQuery} />
      <Form.Checkbox id="useWeb" label="Use Web Search" value={useWeb} onChange={setUseWeb} />
    </Form>
  );
}

function AnswerDetail(props: { answer: string; context: string; onAskAnother: () => void }) {
  const markdown = React.useMemo(() => {
    const parts = [`# Answer`, props.answer, props.context ? `\n---\n## Sources context\n${props.context}` : ""];
    return parts.filter(Boolean).join("\n\n");
  }, [props.answer, props.context]);

  return (
    <Detail
      markdown={markdown}
      navigationTitle="Llm with Search"
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy to Clipboard" content={props.answer} />
          <Action title="Ask Another Question" onAction={props.onAskAnother} />
        </ActionPanel>
      }
    />
  );
}
