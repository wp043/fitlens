"use client";

import type { CriteriaTemplate } from "@/lib/criteria";
import type { DecisionProfile } from "@/lib/decision-profiles";
import type { Messages } from "@/lib/i18n";
import type { ComparisonCriterion } from "@/lib/types";
import type { SourceFailure } from "@/lib/workbench-state";

interface ComparisonBuilderEditorProps {
  urls: string[];
  failures: SourceFailure[];
  context: string;
  criteria: ComparisonCriterion[];
  templates: CriteriaTemplate[];
  activeTemplateId: string;
  templateName: string;
  decisionProfiles: DecisionProfile[];
  decisionProfileName: string;
  showDecisionProfiles: boolean;
  messages: Messages;
  onUrlsChange(urls: string[], changedIndex: number): void;
  onMove(index: number, offset: -1 | 1): void;
  onRemove(index: number): void;
  onAdd(): void;
  onContextChange(context: string): void;
  onApplyTemplate(template: CriteriaTemplate): void;
  onDeleteTemplate(id: string): void;
  onTemplateNameChange(name: string): void;
  onSaveTemplate(): void;
  onCriterionChange(
    key: string,
    update: Partial<Omit<ComparisonCriterion, "key">>,
  ): void;
  onRemoveCriterion(key: string): void;
  onAddCriterion(): void;
  onApplyDecisionProfile(profile: DecisionProfile): void;
  onDeleteDecisionProfile(id: string): void;
  onDecisionProfileNameChange(name: string): void;
  onSaveDecisionProfile(): void;
}

export function ComparisonBuilderEditor(props: ComparisonBuilderEditorProps) {
  const { messages: t } = props;
  return (
    <>
      <div className="url-grid">
        {props.urls.map((url, index) => {
          const failure = props.failures.find((item) => item.index === index);
          const diagnosticId = `source-failure-${index}`;
          return (
            <div
              className={`url-field${failure ? " source-failed" : ""}`}
              key={index}
            >
              <span>
                {t.product} {String.fromCharCode(65 + index)}
              </span>
              <div className="url-input-row">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7-7.1l-1.1 1" />
                  <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7 7.1l1.1-1" />
                </svg>
                <input
                  value={url}
                  placeholder={`https://product-${String.fromCharCode(97 + index)}.com`}
                  onChange={(event) => {
                    const next = [...props.urls];
                    next[index] = event.target.value;
                    props.onUrlsChange(next, index);
                  }}
                  aria-label={`${t.product} ${String.fromCharCode(65 + index)} URL`}
                  aria-invalid={failure ? true : undefined}
                  aria-describedby={failure ? diagnosticId : undefined}
                />
                <div className="url-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => props.onMove(index, -1)}
                    aria-label={`${t.moveProductUp}: ${index + 1}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === props.urls.length - 1}
                    onClick={() => props.onMove(index, 1)}
                    aria-label={`${t.moveProductDown}: ${index + 1}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={props.urls.length <= 2}
                    onClick={() => props.onRemove(index)}
                    aria-label={`${t.removeProduct}: ${index + 1}`}
                  >
                    ×
                  </button>
                </div>
              </div>
              {failure && (
                <p className="source-failure-detail" id={diagnosticId}>
                  <strong>{failure.code}</strong>
                  {t[failure.code]}
                </p>
              )}
            </div>
          );
        })}
        {props.urls.length < 8 && (
          <button
            className="add-product-button"
            type="button"
            onClick={props.onAdd}
          >
            + {t.addProduct}
          </button>
        )}
      </div>
      <div className="profile-grid">
        <div className="context-block">
          <div className="section-label">
            <span className="step-index">02</span>
            <h2>{t.scenarioTitle}</h2>
          </div>
          <textarea
            value={props.context}
            placeholder={t.scenarioPlaceholder}
            onChange={(event) => props.onContextChange(event.target.value)}
            rows={7}
          />
          <p>{t.scenarioHint}</p>
        </div>
        <div className="priorities-block">
          <div className="section-label">
            <span className="step-index">03</span>
            <h2>{t.prioritiesTitle}</h2>
          </div>
          <div className="preference-profiles">
            <div className="profile-chips">
              {props.templates.map((template) => (
                <span
                  className={`profile-chip ${props.activeTemplateId === template.id ? "active" : ""}`}
                  key={template.id}
                >
                  <button
                    type="button"
                    onClick={() => props.onApplyTemplate(template)}
                  >
                    {template.name}
                  </button>
                  {!template.builtIn && (
                    <button
                      type="button"
                      aria-label={`${t.deleteTemplate}: ${template.name}`}
                      onClick={() => props.onDeleteTemplate(template.id)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="save-profile">
              <input
                value={props.templateName}
                maxLength={32}
                placeholder={t.saveTemplatePlaceholder}
                aria-label={t.templateNameAria}
                onChange={(event) =>
                  props.onTemplateNameChange(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onSaveTemplate();
                }}
              />
              <button
                type="button"
                disabled={!props.templateName.trim()}
                onClick={props.onSaveTemplate}
              >
                {t.save}
              </button>
            </div>
          </div>
          <div className="criteria-editor">
            <p className="criteria-help">{t.criteriaHelp}</p>
            {props.criteria.map((criterion, index) => (
              <div className="criterion-card" key={criterion.key}>
                <div className="criterion-fields">
                  <span className="criterion-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <label>
                    <span>{t.criterionName}</span>
                    <input
                      value={criterion.label}
                      maxLength={80}
                      onChange={(event) =>
                        props.onCriterionChange(criterion.key, {
                          label: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>{t.criterionDescription}</span>
                    <input
                      value={criterion.hint}
                      maxLength={200}
                      onChange={(event) =>
                        props.onCriterionChange(criterion.key, {
                          hint: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="remove-criterion"
                    type="button"
                    disabled={props.criteria.length <= 2}
                    aria-label={`${t.removeCriterion}: ${criterion.label}`}
                    onClick={() => props.onRemoveCriterion(criterion.key)}
                  >
                    ×
                  </button>
                </div>
                <label className="criterion-weight">
                  <span className="slider-copy">
                    <span>
                      <strong>{t.weight}</strong>
                      <small>{criterion.hint}</small>
                    </span>
                    <b>{criterion.weight}</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={criterion.weight}
                    onChange={(event) =>
                      props.onCriterionChange(criterion.key, {
                        weight: Number(event.target.value),
                      })
                    }
                    style={
                      {
                        "--range": `${criterion.weight}%`,
                      } as React.CSSProperties
                    }
                  />
                </label>
              </div>
            ))}
            <button
              className="add-criterion"
              type="button"
              disabled={props.criteria.length >= 8}
              onClick={props.onAddCriterion}
            >
              <span>+</span> {t.addCriterion}
              <small>{props.criteria.length}/8</small>
            </button>
          </div>
        </div>
      </div>
      {props.showDecisionProfiles && (
        <section className="decision-profiles-card">
          <div>
            <p className="eyebrow">{t.decisionProfilesTitle}</p>
            <h3>{t.decisionProfilesTitle}</h3>
            <p>{t.decisionProfilesCopy}</p>
          </div>
          <div className="decision-profile-list">
            {props.decisionProfiles.length > 0 ? (
              props.decisionProfiles.map((profile) => (
                <span key={profile.id}>
                  <button
                    type="button"
                    onClick={() => props.onApplyDecisionProfile(profile)}
                  >
                    {profile.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t.deleteTemplate}: ${profile.name}`}
                    onClick={() => props.onDeleteDecisionProfile(profile.id)}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <small>{t.noDecisionProfiles}</small>
            )}
          </div>
          <div className="decision-profile-save">
            <input
              value={props.decisionProfileName}
              placeholder={t.decisionProfileName}
              onChange={(event) =>
                props.onDecisionProfileNameChange(event.target.value)
              }
            />
            <button
              type="button"
              disabled={
                !props.decisionProfileName.trim() ||
                props.context.trim().length < 10
              }
              onClick={props.onSaveDecisionProfile}
            >
              {t.saveDecisionProfile}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
