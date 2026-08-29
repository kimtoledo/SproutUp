/**
 * Wiring helper for labelled form controls. Given a control `name` and which
 * optional slots are present, it returns the ids/attributes that keep the label,
 * description, and error message associated with the input for assistive tech.
 */
export interface FieldWiringInput {
  name: string;
  idPrefix?: string;
  hasDescription?: boolean;
  hasError?: boolean;
}

export interface FieldWiring {
  inputId: string;
  descriptionId: string | undefined;
  errorId: string | undefined;
  describedBy: string | undefined;
  ariaInvalid: true | undefined;
}

export function fieldWiring({
  name,
  idPrefix = 'field',
  hasDescription = false,
  hasError = false,
}: FieldWiringInput): FieldWiring {
  const inputId = `${idPrefix}-${name}`;
  const descriptionId = hasDescription ? `${inputId}-description` : undefined;
  const errorId = hasError ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return {
    inputId,
    descriptionId,
    errorId,
    describedBy,
    ariaInvalid: hasError ? true : undefined,
  };
}
