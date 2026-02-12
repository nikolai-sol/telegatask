---
name: add-firestore-model
description: Add or modify a Firestore collection, model interface, and repository in telegatask. Use when the user asks to add a data model, collection, entity, or change database schema.
---

# Adding a Firestore Model + Repository

## Architecture

```
src/models/myEntity.ts        — TypeScript interface
src/repositories/myEntityRepository.ts  — Firestore CRUD
```

## Step 1: Model (src/models/myEntity.ts)

```typescript
export interface MyEntity {
  id: string;                    // Firestore doc id
  // ... fields ...
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

Conventions:
- All dates as ISO strings (not Firestore Timestamp)
- Optional fields: `field?: type | null`
- Export type aliases for enums: `export type MyStatus = "a" | "b"`

## Step 2: Repository (src/repositories/myEntityRepository.ts)

```typescript
import { firestore } from "../config/firebase";
import { MyEntity } from "../models/myEntity";

const collection = firestore.collection("myEntities");

function docToEntity(id: string, data: FirebaseFirestore.DocumentData): MyEntity {
  return {
    id,
    // ... map fields with defaults for backward compat ...
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function createMyEntity(input: CreateInput): Promise<MyEntity> {
  const now = new Date().toISOString();
  const payload = { ...input, createdAt: now, updatedAt: now };
  const docRef = await collection.add(payload);
  return { id: docRef.id, ...payload };
}

export async function getMyEntityById(id: string): Promise<MyEntity | null> {
  const doc = await collection.doc(id).get();
  if (!doc.exists) return null;
  return docToEntity(doc.id, doc.data()!);
}
```

## Conventions

- Always use `docToEntity()` normalizer with defaults for new fields
- `collection.add()` for auto-ID, `collection.doc(id).set()` for custom ID
- Queries use `.where()` + `.limit()`, never load full collection
- Backward compat: new fields get defaults in `docToEntity()`
