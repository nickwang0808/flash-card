export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      card_snapshots: {
        Row: {
          card_id: string
          created_at: string
          event_type: string
          id: string
          snapshot: Json
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          event_type: string
          id?: string
          snapshot: Json
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          event_type?: string
          id?: string
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_snapshots_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          _deleted: boolean
          _modified: string
          approved: boolean
          back: string
          created: string
          deck_name: string
          front: string | null
          id: string
          order: number
          reversible: boolean
          suspended: boolean
          tags: string[] | null
          term: string
          user_id: string
        }
        Insert: {
          _deleted?: boolean
          _modified?: string
          approved?: boolean
          back: string
          created: string
          deck_name: string
          front?: string | null
          id: string
          order?: number
          reversible?: boolean
          suspended?: boolean
          tags?: string[] | null
          term: string
          user_id: string
        }
        Update: {
          _deleted?: boolean
          _modified?: string
          approved?: boolean
          back?: string
          created?: string
          deck_name?: string
          front?: string | null
          id?: string
          order?: number
          reversible?: boolean
          suspended?: boolean
          tags?: string[] | null
          term?: string
          user_id?: string
        }
        Relationships: []
      }
      review_logs: {
        Row: {
          _deleted: boolean
          _modified: string
          card_id: string
          difficulty: number
          due: string
          elapsed_days: number
          id: string
          is_reverse: boolean
          last_elapsed_days: number
          rating: number
          review: string
          scheduled_days: number
          stability: number
          state: number
          user_id: string
        }
        Insert: {
          _deleted?: boolean
          _modified?: string
          card_id: string
          difficulty: number
          due: string
          elapsed_days: number
          id: string
          is_reverse?: boolean
          last_elapsed_days: number
          rating: number
          review: string
          scheduled_days: number
          stability: number
          state: number
          user_id: string
        }
        Update: {
          _deleted?: boolean
          _modified?: string
          card_id?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          id?: string
          is_reverse?: boolean
          last_elapsed_days?: number
          rating?: number
          review?: string
          scheduled_days?: number
          stability?: number
          state?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          _modified: string
          id: string
          new_cards_per_day: number
          review_order: string
          theme: string
          user_id: string
        }
        Insert: {
          _modified?: string
          id: string
          new_cards_per_day?: number
          review_order?: string
          theme?: string
          user_id: string
        }
        Update: {
          _modified?: string
          id?: string
          new_cards_per_day?: number
          review_order?: string
          theme?: string
          user_id?: string
        }
        Relationships: []
      }
      srs_state: {
        Row: {
          _modified: string
          card_id: string
          difficulty: number | null
          direction: string
          due: string | null
          elapsed_days: number | null
          id: string
          lapses: number | null
          last_review: string | null
          reps: number | null
          scheduled_days: number | null
          stability: number | null
          state: number | null
          user_id: string
        }
        Insert: {
          _modified?: string
          card_id: string
          difficulty?: number | null
          direction: string
          due?: string | null
          elapsed_days?: number | null
          id: string
          lapses?: number | null
          last_review?: string | null
          reps?: number | null
          scheduled_days?: number | null
          stability?: number | null
          state?: number | null
          user_id: string
        }
        Update: {
          _modified?: string
          card_id?: string
          difficulty?: number | null
          direction?: string
          due?: string | null
          elapsed_days?: number | null
          id?: string
          lapses?: number | null
          last_review?: string | null
          reps?: number | null
          scheduled_days?: number | null
          stability?: number | null
          state?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "srs_state_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

