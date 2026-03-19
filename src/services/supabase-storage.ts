import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';
import type { CardData } from './card-repository';

type CardsRow = Database['public']['Tables']['cards']['Row'];
type SrsStateRow = Database['public']['Tables']['srs_state']['Row'];

/**
 * Maps between nested RxDB CardDoc (with embedded state/reverseState)
 * and normalized Postgres rows (cards + srs_state).
 */
export class SupabaseStorageService {
  constructor(private supabase: SupabaseClient<Database>) {}

  async pullAllCards(): Promise<CardData[]> {
    const userId = await this.getUserId();

    const [cardsResult, srsResult] = await Promise.all([
      this.supabase
        .from('cards')
        .select('*')
        .eq('user_id', userId)
        .eq('_deleted', false),
      this.supabase
        .from('srs_state')
        .select('*')
        .eq('user_id', userId),
    ]);

    if (cardsResult.error) throw cardsResult.error;
    if (srsResult.error) throw srsResult.error;

    // Index SRS state by card_id + direction
    const srsMap = new Map<string, SrsStateRow>();
    for (const row of srsResult.data) {
      srsMap.set(`${row.card_id}:${row.direction}`, row);
    }

    return cardsResult.data.map((card) =>
      this.joinCardWithSrs(card, srsMap)
    );
  }

  async pushCards(cards: CardData[]): Promise<void> {
    const userId = await this.getUserId();
    const now = new Date().toISOString();

    const cardRows: Database['public']['Tables']['cards']['Insert'][] = [];
    const srsRows: Database['public']['Tables']['srs_state']['Insert'][] = [];

    for (const card of cards) {
      const cardId = `${card.deckName}|${card.term}`;

      cardRows.push({
        id: cardId,
        user_id: userId,
        deck_name: card.deckName,
        term: card.term,
        front: card.front ?? null,
        back: card.back,
        tags: card.tags ?? [],
        created: card.created,
        reversible: card.reversible,
        order: card.order,
        suspended: card.suspended ?? false,
        _modified: now,
        _deleted: false,
      });

      // Forward SRS state
      if (card.state) {
        srsRows.push(this.toSrsRow(cardId, userId, 'forward', card.state, now));
      }

      // Reverse SRS state
      if (card.reverseState) {
        srsRows.push(this.toSrsRow(cardId, userId, 'reverse', card.reverseState, now));
      }
    }

    // Upsert cards
    if (cardRows.length > 0) {
      const { error } = await this.supabase
        .from('cards')
        .upsert(cardRows, { onConflict: 'id' });
      if (error) throw error;
    }

    // Upsert SRS state
    if (srsRows.length > 0) {
      const { error } = await this.supabase
        .from('srs_state')
        .upsert(srsRows, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  async pushReviewLogs(logs: Array<{
    id: string;
    cardId: string;
    isReverse: boolean;
    rating: number;
    state: number;
    due: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    last_elapsed_days: number;
    scheduled_days: number;
    review: string;
  }>): Promise<void> {
    const userId = await this.getUserId();
    const now = new Date().toISOString();

    const rows: Database['public']['Tables']['review_logs']['Insert'][] = logs.map((log) => ({
      id: log.id,
      user_id: userId,
      card_id: log.cardId,
      is_reverse: log.isReverse,
      rating: log.rating,
      state: log.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsed_days: log.elapsed_days,
      last_elapsed_days: log.last_elapsed_days,
      scheduled_days: log.scheduled_days,
      review: log.review,
      _modified: now,
      _deleted: false,
    }));

    if (rows.length > 0) {
      const { error } = await this.supabase
        .from('review_logs')
        .upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  async pushSettings(settings: {
    id: string;
    newCardsPerDay: number;
    reviewOrder: string;
    theme: string;
  }): Promise<void> {
    const userId = await this.getUserId();
    const now = new Date().toISOString();

    const { error } = await this.supabase
      .from('settings')
      .upsert({
        id: settings.id,
        user_id: userId,
        new_cards_per_day: settings.newCardsPerDay,
        review_order: settings.reviewOrder,
        theme: settings.theme,
        _modified: now,
      }, { onConflict: 'id' });
    if (error) throw error;
  }

  async pullSettings(): Promise<{
    newCardsPerDay: number;
    reviewOrder: string;
    theme: string;
  } | null> {
    const userId = await this.getUserId();

    const { data, error } = await this.supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      newCardsPerDay: data.new_cards_per_day,
      reviewOrder: data.review_order,
      theme: data.theme,
    };
  }

  async pullReviewLogs(): Promise<Array<{
    id: string;
    cardId: string;
    isReverse: boolean;
    rating: number;
    state: number;
    due: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    last_elapsed_days: number;
    scheduled_days: number;
    review: string;
  }>> {
    const userId = await this.getUserId();

    const { data, error } = await this.supabase
      .from('review_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('_deleted', false);

    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      cardId: row.card_id,
      isReverse: row.is_reverse,
      rating: row.rating,
      state: row.state,
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      last_elapsed_days: row.last_elapsed_days,
      scheduled_days: row.scheduled_days,
      review: row.review,
    }));
  }

  // --- Private helpers ---

  private cachedUserId: string | null = null;

  private async getUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    this.cachedUserId = user.id;
    return user.id;
  }

  private joinCardWithSrs(
    card: CardsRow,
    srsMap: Map<string, SrsStateRow>,
  ): CardData {
    const forwardSrs = srsMap.get(`${card.id}:forward`);
    const reverseSrs = srsMap.get(`${card.id}:reverse`);

    return {
      deckName: card.deck_name,
      term: card.term,
      front: card.front ?? undefined,
      back: card.back,
      tags: card.tags ?? undefined,
      created: card.created,
      reversible: card.reversible,
      order: card.order,
      state: forwardSrs ? this.srsRowToState(forwardSrs) : null,
      reverseState: reverseSrs ? this.srsRowToState(reverseSrs) : null,
      suspended: card.suspended,
    };
  }

  private srsRowToState(row: SrsStateRow): Record<string, unknown> {
    return {
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      scheduled_days: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
      last_review: row.last_review,
    };
  }

  private toSrsRow(
    cardId: string,
    userId: string,
    direction: 'forward' | 'reverse',
    state: Record<string, unknown>,
    now: string,
  ): Database['public']['Tables']['srs_state']['Insert'] {
    return {
      id: `${cardId}:${direction}`,
      user_id: userId,
      card_id: cardId,
      direction,
      due: (state.due as string) ?? null,
      stability: (state.stability as number) ?? null,
      difficulty: (state.difficulty as number) ?? null,
      elapsed_days: (state.elapsed_days as number) ?? null,
      scheduled_days: (state.scheduled_days as number) ?? null,
      reps: (state.reps as number) ?? null,
      lapses: (state.lapses as number) ?? null,
      state: (state.state as number) ?? null,
      last_review: (state.last_review as string) ?? null,
      _modified: now,
    };
  }
}
