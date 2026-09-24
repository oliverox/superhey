// HEY gives every thread two IDs: the box item ("posting") ID and the thread ("topic") ID.
// Commands accept one or the other, and some silently ignore the wrong one, so they are
// distinct types here and cannot be mixed up.

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

export type PostingId = Brand<number, 'PostingId'>
export type TopicId = Brand<number, 'TopicId'>

export const PostingId = (n: number): PostingId => n as PostingId
export const TopicId = (n: number): TopicId => n as TopicId
