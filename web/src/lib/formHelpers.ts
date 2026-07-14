// Shared form-parsing helpers for the admin update/publish routes.
export const asNullableText = (value: FormDataEntryValue | null): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};
