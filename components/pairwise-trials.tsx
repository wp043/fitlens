"use client";

import { useMemo, useState } from "react";
import { calculatePairwiseStandings } from "@/lib/pairwise";
import type { Messages } from "@/lib/i18n";
import type {
  PairwiseTrialOutcome,
  PairwiseTrialResult,
} from "@/lib/types";

interface PairwiseTrialsProps {
  products: string[];
  trials: PairwiseTrialResult[];
  messages: Messages;
  onChange(trials: PairwiseTrialResult[]): void;
}

export function PairwiseTrials({ products, trials, messages: t, onChange }: PairwiseTrialsProps) {
  const [firstProduct, setFirstProduct] = useState(products[0] ?? "");
  const [secondProduct, setSecondProduct] = useState(products[1] ?? "");
  const [task, setTask] = useState("");
  const standings = useMemo(
    () => calculatePairwiseStandings(products, trials),
    [products, trials],
  );

  function addTrial() {
    if (!task.trim() || firstProduct === secondProduct) return;
    onChange([
      ...trials,
      {
        id: crypto.randomUUID(),
        firstProduct,
        secondProduct,
        task: task.trim(),
        outcome: "untested",
        note: "",
      },
    ]);
    setTask("");
  }

  function update(id: string, change: Partial<Pick<PairwiseTrialResult, "outcome" | "note">>) {
    onChange(trials.map((trial) =>
      trial.id === id
        ? { ...trial, ...change, updatedAt: new Date().toISOString() }
        : trial,
    ));
  }

  return (
    <section className="pairwise-card">
      <header>
        <div>
          <p className="eyebrow">{t.pairwiseEyebrow}</p>
          <h2>{t.pairwiseTitle}</h2>
          <p>{t.pairwiseCopy}</p>
        </div>
        <div className="pairwise-standings">
          <strong>{t.pairwiseStandings}</strong>
          {standings.map((standing, index) => (
            <span key={standing.product}>
              <b>{index + 1}</b> {standing.product}
              <small>{t.pairwiseRecord
                .replace("{wins}", String(standing.wins))
                .replace("{losses}", String(standing.losses))
                .replace("{ties}", String(standing.ties))}</small>
            </span>
          ))}
        </div>
      </header>
      <div className="pairwise-builder">
        <select value={firstProduct} onChange={(event) => setFirstProduct(event.target.value)}>
          {products.map((product) => <option key={product}>{product}</option>)}
        </select>
        <span>vs</span>
        <select value={secondProduct} onChange={(event) => setSecondProduct(event.target.value)}>
          {products.map((product) => <option key={product}>{product}</option>)}
        </select>
        <input value={task} placeholder={t.pairwiseTask} onChange={(event) => setTask(event.target.value)} />
        <button type="button" disabled={!task.trim() || firstProduct === secondProduct} onClick={addTrial}>
          + {t.pairwiseAdd}
        </button>
      </div>
      <div className="pairwise-list">
        {trials.map((trial) => (
          <article key={trial.id}>
            <div>
              <strong>{trial.firstProduct} <i>vs</i> {trial.secondProduct}</strong>
              <p>{trial.task}</p>
            </div>
            <select
              value={trial.outcome}
              onChange={(event) => update(trial.id, { outcome: event.target.value as PairwiseTrialOutcome })}
            >
              <option value="untested">{t.pairwiseUntested}</option>
              <option value="first">{t.pairwiseFirstWins.replace("{product}", trial.firstProduct)}</option>
              <option value="second">{t.pairwiseSecondWins.replace("{product}", trial.secondProduct)}</option>
              <option value="tie">{t.pairwiseTie}</option>
            </select>
            <input value={trial.note} placeholder={t.pairwiseNote} onChange={(event) => update(trial.id, { note: event.target.value })} />
            <button type="button" onClick={() => onChange(trials.filter((item) => item.id !== trial.id))}>
              {t.pairwiseDelete}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
