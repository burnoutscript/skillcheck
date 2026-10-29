---
name: pdf-forms
description: Fills, flattens and validates PDF forms, mapping user data onto AcroForm fields. Use when the user asks to "fill a PDF form", wants to populate a fillable PDF, or needs to check which fields a PDF has.
---

# PDF forms

Fill fillable PDFs reliably.

## Process

1. List the fields first with the bundled script.
2. Map the user's data onto field names. Ask about any field you can't map.
3. Fill, then flatten if the user wants a non-editable copy.

Field type details live in [the field reference](references/fields.md).

## Example

Input: "Fill this W-9 with my details"

```bash
python scripts/fill.py form.pdf data.json out.pdf
```

Output: `out.pdf` with every mapped field filled and a list of unmapped fields.
