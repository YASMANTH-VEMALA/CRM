"use client";

import { useActionState, useState, type FormEvent } from "react";
import { aiSearch, draftMessage, summarizeRecord } from "../actions/ai";
import type { AiAssistantData } from "@/lib/data/aiAssistant";
import type { SourceTable } from "@/lib/ai/embed";
import { PageHead, SectionHead } from "./shared";

const TABS = ["Ask AI", "Semantic search", "Summarize & draft"];

type ChatEntry = { role: "user" | "assistant"; content: string };

export function AiAssistantView({ data }: { data: AiAssistantData }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Intelligence / AI assistant"
        title="Ask AI"
        description="Ask questions, search by meaning, and draft or summarize records — grounded in live product, customer, and supplier data."
      />

      <div className="crm-tabs" role="tablist" aria-label="AI assistant views">
        {TABS.map((tab) => (
          <button
            className={activeTab === tab ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Ask AI" && <ChatPanel />}
      {activeTab === "Semantic search" && <SearchPanel />}
      {activeTab === "Summarize & draft" && <SummarizeDraftPanel data={data} />}
    </div>
  );
}

function ChatPanel() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const finalAnswer = answer;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: finalAnswer };
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant is unavailable right now.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="crm-panel crm-enter">
      <SectionHead title="Ask AI" note="Answers are grounded in current product, customer, and supplier records." />
      <div className="crm-chat-thread">
        {messages.length === 0 && (
          <p className="crm-chat-empty">Ask about stock levels, customer balances, suppliers, or anything else in the CRM.</p>
        )}
        {messages.map((message, index) => (
          <div className={`crm-chat-bubble is-${message.role}`} key={index}>
            {message.content || (pending && index === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <form className="crm-chat-composer" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask a question…"
          disabled={pending}
          aria-label="Ask AI"
        />
        <button className="crm-button crm-button-primary" type="submit" disabled={pending || !input.trim()}>
          {pending ? "Thinking…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function SearchPanel() {
  const [state, formAction, pending] = useActionState(aiSearch, null);

  return (
    <section className="crm-panel crm-enter">
      <SectionHead title="Semantic search" note="Finds products, customers, and suppliers by meaning, not just exact text." />
      <form action={formAction} className="crm-chat-composer">
        <input name="query" placeholder="Try “inhaler for asthma” or “customer with overdue credit”…" aria-label="Semantic search" />
        <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {state && !state.ok && (
        <p className="login-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div className="crm-search-result-list">
          {state.results.length === 0 && <p style={{ padding: "1rem 1.1rem", color: "#777" }}>No matches for “{state.query}”.</p>}
          {state.results.map((result) => (
            <div className="crm-search-result" key={result.id}>
              <span>{result.sourceTable}</span>
              <p>{result.content}</p>
              <strong>{Math.round(result.similarity * 100)}% match</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SummarizeDraftPanel({ data }: { data: AiAssistantData }) {
  const [sourceTable, setSourceTable] = useState<SourceTable>("products");
  const [summaryState, summaryAction, summaryPending] = useActionState(summarizeRecord, null);
  const [draftState, draftAction, draftPending] = useActionState(draftMessage, null);

  const records = sourceTable === "products" ? data.products : sourceTable === "customers" ? data.customers : data.suppliers;

  return (
    <>
      <section className="crm-panel crm-enter">
        <SectionHead title="Summarize a record" note="Generates a short summary grounded in the record's current data." />
        <form action={summaryAction} className="crm-form-grid">
          <label>
            <span>Record type</span>
            <select name="source_table" value={sourceTable} onChange={(event) => setSourceTable(event.target.value as SourceTable)}>
              <option value="products">Product</option>
              <option value="customers">Customer</option>
              <option value="suppliers">Supplier</option>
            </select>
          </label>
          <label>
            <span>Record</span>
            <select name="source_id" required defaultValue="" key={sourceTable}>
              <option value="" disabled>
                Select a record
              </option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
          </label>
          <div className="crm-form-actions">
            <button className="crm-button crm-button-primary" type="submit" disabled={summaryPending}>
              {summaryPending ? "Summarizing…" : "Summarize"}
            </button>
          </div>
        </form>
        {summaryState && !summaryState.ok && (
          <p className="login-error" role="alert">
            {summaryState.error}
          </p>
        )}
        {summaryState?.ok && <div className="crm-ai-output">{summaryState.summary}</div>}
      </section>

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="Draft a customer message" note="Drafts a short message grounded in the customer's current data." />
        <form action={draftAction} className="crm-form-grid">
          <label>
            <span>Customer</span>
            <select name="customer_id" required defaultValue="">
              <option value="" disabled>
                Select a customer
              </option>
              {data.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="is-wide">
            <span>What should the message do?</span>
            <input name="intent" required placeholder="e.g. remind them about their outstanding credit balance" />
          </label>
          <div className="crm-form-actions">
            <button className="crm-button crm-button-primary" type="submit" disabled={draftPending}>
              {draftPending ? "Drafting…" : "Draft message"}
            </button>
          </div>
        </form>
        {draftState && !draftState.ok && (
          <p className="login-error" role="alert">
            {draftState.error}
          </p>
        )}
        {draftState?.ok && <div className="crm-ai-output">{draftState.draft}</div>}
      </section>
    </>
  );
}
