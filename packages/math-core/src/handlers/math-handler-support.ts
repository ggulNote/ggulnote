import type { MathCreateBaseInput } from "../actions/math-action";
import type {
  BaseMathObject,
  MathObject,
  MathObjectChild,
  MathObjectKind,
} from "../domain/math-object";
import { serializeMathObject } from "../serialization/math-object-serializer";

export type MathObjectOfKind<TKind extends MathObjectKind> = Extract<
  MathObject,
  { readonly kind: TKind }
>;

export const createBaseMathObject = (
  kind: MathObjectKind,
  objectId: string,
  input: MathCreateBaseInput,
  children: readonly MathObjectChild[] = [],
): BaseMathObject => {
  if (objectId.length === 0) throw new TypeError("Math object id must not be empty.");
  return {
    id: objectId,
    kind,
    bounds: { ...input.bounds },
    style: { ...input.style },
    ...(input.label === undefined ? {} : { label: input.label }),
    metadata: {},
    children,
  };
};

export const requireMathObject = <TKind extends MathObjectKind>(
  object: MathObject | undefined,
  kind: TKind,
  objectId: string,
): MathObjectOfKind<TKind> => {
  if (object === undefined || object.id !== objectId || object.kind !== kind) {
    throw new Error(`Math ${kind} target does not exist: ${objectId}`);
  }
  return object as MathObjectOfKind<TKind>;
};

export const validateMathObject = <TObject extends MathObject>(
  object: TObject,
): TObject => {
  serializeMathObject(object);
  return object;
};

export const nextSubEntityIds = (
  objectId: string,
  entityKind: string,
  count: number,
  occupiedIds: ReadonlySet<string> = new Set(),
): readonly string[] => {
  const ids: string[] = [];
  let sequence = 1;
  while (ids.length < count) {
    const candidate = `${objectId}:${entityKind}:${sequence}`;
    if (!occupiedIds.has(candidate)) ids.push(candidate);
    sequence += 1;
  }
  return ids;
};
