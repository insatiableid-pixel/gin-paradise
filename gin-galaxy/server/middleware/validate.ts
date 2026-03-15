import { Request, Response, NextFunction } from "express";

type FieldSpec = {
  name: string;
  type: "string" | "number" | "boolean";
  optional?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
};

/**
 * Factory that returns middleware validating req.body against a field spec.
 * Rejects with 400 and a clear error message on failure.
 */
export function validateBody(fields: FieldSpec[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    for (const field of fields) {
      const value = req.body[field.name];

      if (value === undefined || value === null) {
        if (!field.optional) {
          res.status(400).json({ error: `Missing required field: ${field.name}` });
          return;
        }
        continue;
      }

      if (typeof value !== field.type) {
        res.status(400).json({ error: `Field '${field.name}' must be of type ${field.type}` });
        return;
      }

      if (field.type === "string") {
        if (field.minLength !== undefined && (value as string).length < field.minLength) {
          res.status(400).json({ error: `Field '${field.name}' must be at least ${field.minLength} characters` });
          return;
        }
        if (field.maxLength !== undefined && (value as string).length > field.maxLength) {
          res.status(400).json({ error: `Field '${field.name}' must be at most ${field.maxLength} characters` });
          return;
        }
      }

      if (field.type === "number") {
        if (field.min !== undefined && (value as number) < field.min) {
          res.status(400).json({ error: `Field '${field.name}' must be at least ${field.min}` });
          return;
        }
        if (field.max !== undefined && (value as number) > field.max) {
          res.status(400).json({ error: `Field '${field.name}' must be at most ${field.max}` });
          return;
        }
      }
    }

    next();
  };
}
