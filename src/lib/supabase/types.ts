export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
      commissioner_actions: {
        Row: {
          created_at: string
          description: string | null
          disclosure_note: string | null
          id: string
          related_id: string | null
          season: number
          source_ref: string | null
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          disclosure_note?: string | null
          id?: string
          related_id?: string | null
          season: number
          source_ref?: string | null
          type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          disclosure_note?: string | null
          id?: string
          related_id?: string | null
          season?: number
          source_ref?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissioner_actions_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
        ]
      }
      draft_live_backups: {
        Row: {
          created_at: string
          id: string
          season: number
          state: Json
        }
        Insert: {
          created_at?: string
          id?: string
          season: number
          state: Json
        }
        Update: {
          created_at?: string
          id?: string
          season?: number
          state?: Json
        }
        Relationships: []
      }
      draft_live_state: {
        Row: {
          revision: number
          season: number
          state: Json
          updated_at: string
        }
        Insert: {
          revision?: number
          season: number
          state: Json
          updated_at?: string
        }
        Update: {
          revision?: number
          season?: number
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      draft_order: {
        Row: {
          created_at: string
          locked: boolean
          locked_at: string | null
          season: number
          slot: number
          source: string
          team_id: string
        }
        Insert: {
          created_at?: string
          locked?: boolean
          locked_at?: string | null
          season: number
          slot: number
          source?: string
          team_id: string
        }
        Update: {
          created_at?: string
          locked?: boolean
          locked_at?: string | null
          season?: number
          slot?: number
          source?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_order_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
          {
            foreignKeyName: "draft_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_recap: {
        Row: {
          created_at: string
          recap: Json
          season: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          recap: Json
          season: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          recap?: Json
          season?: number
          updated_at?: string
        }
        Relationships: []
      }
      draft_slots: {
        Row: {
          current_team_id: string
          id: string
          is_keeper: boolean
          original_team_id: string
          overall_pick: number
          pick_in_round: number
          player_id: string | null
          round: number
          season: number
          smartdraft_slot_key: string | null
          updated_at: string
        }
        Insert: {
          current_team_id: string
          id?: string
          is_keeper?: boolean
          original_team_id: string
          overall_pick: number
          pick_in_round: number
          player_id?: string | null
          round: number
          season: number
          smartdraft_slot_key?: string | null
          updated_at?: string
        }
        Update: {
          current_team_id?: string
          id?: string
          is_keeper?: boolean
          original_team_id?: string
          overall_pick?: number
          pick_in_round?: number
          player_id?: string | null
          round?: number
          season?: number
          smartdraft_slot_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_slots_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_slots_original_team_id_fkey"
            columns: ["original_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "draft_slots_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
        ]
      }
      draft_state: {
        Row: {
          clock_seconds: number
          clock_started_at: string | null
          current_overall_pick: number | null
          paused_at: string | null
          season: number
          status: Database["public"]["Enums"]["draft_status"]
          updated_at: string
        }
        Insert: {
          clock_seconds?: number
          clock_started_at?: string | null
          current_overall_pick?: number | null
          paused_at?: string | null
          season: number
          status?: Database["public"]["Enums"]["draft_status"]
          updated_at?: string
        }
        Update: {
          clock_seconds?: number
          clock_started_at?: string | null
          current_overall_pick?: number | null
          paused_at?: string | null
          season?: number
          status?: Database["public"]["Enums"]["draft_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_state_season_fkey"
            columns: ["season"]
            isOneToOne: true
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
        ]
      }
      fantasypros_cache: {
        Row: {
          fetched_at: string
          key: string
          payload: Json
          updated_at: string
        }
        Insert: {
          fetched_at?: string
          key: string
          payload: Json
          updated_at?: string
        }
        Update: {
          fetched_at?: string
          key?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      fantasypros_oauth: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          client_id: string
          client_secret: string | null
          created_at: string
          id: string
          issuer: string
          refresh_token: string
          resource: string
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          client_id: string
          client_secret?: string | null
          created_at?: string
          id?: string
          issuer: string
          refresh_token: string
          resource: string
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          client_id?: string
          client_secret?: string | null
          created_at?: string
          id?: string
          issuer?: string
          refresh_token?: string
          resource?: string
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      keeper_rights: {
        Row: {
          acquired_at: string | null
          acquisition_season: number | null
          basis_round: number | null
          consecutive_seasons: number
          current_team_id: string | null
          is_undrafted: boolean
          last_team_id: string | null
          original_round: number | null
          player_id: string
          prior_owner_acquisitions: Json
          prior_owner_clocks: Json
          updated_at: string
        }
        Insert: {
          acquired_at?: string | null
          acquisition_season?: number | null
          basis_round?: number | null
          consecutive_seasons?: number
          current_team_id?: string | null
          is_undrafted?: boolean
          last_team_id?: string | null
          original_round?: number | null
          player_id: string
          prior_owner_acquisitions?: Json
          prior_owner_clocks?: Json
          updated_at?: string
        }
        Update: {
          acquired_at?: string | null
          acquisition_season?: number | null
          basis_round?: number | null
          consecutive_seasons?: number
          current_team_id?: string | null
          is_undrafted?: boolean
          last_team_id?: string | null
          original_round?: number | null
          player_id?: string
          prior_owner_acquisitions?: Json
          prior_owner_clocks?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keeper_rights_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keeper_rights_last_team_id_fkey"
            columns: ["last_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keeper_rights_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      keepers: {
        Row: {
          acquired_by_trade: boolean
          basis_round: number | null
          clock_reset_by_trade: boolean
          cost_round: number
          declared_at: string
          id: string
          is_undrafted: boolean
          notes: string | null
          player_id: string
          season: number
          seasons_kept: number
          sheet_tenure_year: number | null
          source: string | null
          status: Database["public"]["Enums"]["keeper_status"]
          team_id: string
          updated_at: string
        }
        Insert: {
          acquired_by_trade?: boolean
          basis_round?: number | null
          clock_reset_by_trade?: boolean
          cost_round: number
          declared_at?: string
          id?: string
          is_undrafted?: boolean
          notes?: string | null
          player_id: string
          season: number
          seasons_kept?: number
          sheet_tenure_year?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["keeper_status"]
          team_id: string
          updated_at?: string
        }
        Update: {
          acquired_by_trade?: boolean
          basis_round?: number | null
          clock_reset_by_trade?: boolean
          cost_round?: number
          declared_at?: string
          id?: string
          is_undrafted?: boolean
          notes?: string | null
          player_id?: string
          season?: number
          seasons_kept?: number
          sheet_tenure_year?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["keeper_status"]
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keepers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "keepers_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
          {
            foreignKeyName: "keepers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          cost_round_step: number
          created_at: string
          draft_rounds: number
          espn_league_id: number | null
          keepers_active: boolean
          keepers_per_team: number
          max_keeper_seasons: number
          name: string
          offline_draft: boolean
          season: number
          settings: Json
          snake_draft: boolean
          team_count: number
          total_slots: number | null
          trade_deadline_week: number | null
          trade_resets_keeper_clock: boolean
          undrafted_cost_round: number
          updated_at: string
        }
        Insert: {
          cost_round_step?: number
          created_at?: string
          draft_rounds?: number
          espn_league_id?: number | null
          keepers_active?: boolean
          keepers_per_team?: number
          max_keeper_seasons?: number
          name?: string
          offline_draft?: boolean
          season: number
          settings?: Json
          snake_draft?: boolean
          team_count?: number
          total_slots?: number | null
          trade_deadline_week?: number | null
          trade_resets_keeper_clock?: boolean
          undrafted_cost_round?: number
          updated_at?: string
        }
        Update: {
          cost_round_step?: number
          created_at?: string
          draft_rounds?: number
          espn_league_id?: number | null
          keepers_active?: boolean
          keepers_per_team?: number
          max_keeper_seasons?: number
          name?: string
          offline_draft?: boolean
          season?: number
          settings?: Json
          snake_draft?: boolean
          team_count?: number
          total_slots?: number | null
          trade_deadline_week?: number | null
          trade_resets_keeper_clock?: boolean
          undrafted_cost_round?: number
          updated_at?: string
        }
        Relationships: []
      }
      motions: {
        Row: {
          created_at: string
          discussion_closes: string | null
          discussion_opens: string | null
          documentation: string | null
          effective_date: string | null
          id: string
          proposer_team: string | null
          season: number
          seconded_by_team: string | null
          status: Database["public"]["Enums"]["motion_status"]
          threshold: Database["public"]["Enums"]["motion_threshold"]
          type: string
        }
        Insert: {
          created_at?: string
          discussion_closes?: string | null
          discussion_opens?: string | null
          documentation?: string | null
          effective_date?: string | null
          id?: string
          proposer_team?: string | null
          season: number
          seconded_by_team?: string | null
          status?: Database["public"]["Enums"]["motion_status"]
          threshold?: Database["public"]["Enums"]["motion_threshold"]
          type: string
        }
        Update: {
          created_at?: string
          discussion_closes?: string | null
          discussion_opens?: string | null
          documentation?: string | null
          effective_date?: string | null
          id?: string
          proposer_team?: string | null
          season?: number
          seconded_by_team?: string | null
          status?: Database["public"]["Enums"]["motion_status"]
          threshold?: Database["public"]["Enums"]["motion_threshold"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "motions_proposer_team_fkey"
            columns: ["proposer_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motions_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
          {
            foreignKeyName: "motions_seconded_by_team_fkey"
            columns: ["seconded_by_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      officers: {
        Row: {
          created_at: string
          id: string
          manager: string | null
          role: Database["public"]["Enums"]["officer_role"]
          season: number
          since: string | null
          status: Database["public"]["Enums"]["officer_status"]
          team_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          manager?: string | null
          role: Database["public"]["Enums"]["officer_role"]
          season: number
          since?: string | null
          status?: Database["public"]["Enums"]["officer_status"]
          team_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          manager?: string | null
          role?: Database["public"]["Enums"]["officer_role"]
          season?: number
          since?: string | null
          status?: Database["public"]["Enums"]["officer_status"]
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "officers_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
          {
            foreignKeyName: "officers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_ownership: {
        Row: {
          current_team: string
          id: string
          original_team: string
          round: number
          season: number
          updated_at: string
        }
        Insert: {
          current_team: string
          id?: string
          original_team: string
          round: number
          season: number
          updated_at?: string
        }
        Update: {
          current_team?: string
          id?: string
          original_team?: string
          round?: number
          season?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_ownership_current_team_fkey"
            columns: ["current_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_ownership_original_team_fkey"
            columns: ["original_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          adp: number | null
          bye_week: number | null
          full_name: string
          metadata: Json
          nfl_team: string | null
          player_id: string
          position: string | null
          position_rank: number | null
          refreshed_at: string
          source: string
        }
        Insert: {
          adp?: number | null
          bye_week?: number | null
          full_name: string
          metadata?: Json
          nfl_team?: string | null
          player_id: string
          position?: string | null
          position_rank?: number | null
          refreshed_at?: string
          source?: string
        }
        Update: {
          adp?: number | null
          bye_week?: number | null
          full_name?: string
          metadata?: Json
          nfl_team?: string | null
          player_id?: string
          position?: string | null
          position_rank?: number | null
          refreshed_at?: string
          source?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          abbrev: string | null
          created_at: string
          draft_slot: number | null
          espn_team_id: number | null
          franchise_name: string
          id: string
          keeper_declarations_closed_at: string | null
          manager: string
          short_name: string
          smartdraft_team_id: string | null
          updated_at: string
        }
        Insert: {
          abbrev?: string | null
          created_at?: string
          draft_slot?: number | null
          espn_team_id?: number | null
          franchise_name: string
          id?: string
          keeper_declarations_closed_at?: string | null
          manager: string
          short_name: string
          smartdraft_team_id?: string | null
          updated_at?: string
        }
        Update: {
          abbrev?: string | null
          created_at?: string
          draft_slot?: number | null
          espn_team_id?: number | null
          franchise_name?: string
          id?: string
          keeper_declarations_closed_at?: string | null
          manager?: string
          short_name?: string
          smartdraft_team_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trade_assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["trade_asset_type"]
          created_at: string
          from_team: string
          id: string
          keeper_clock_reset: boolean
          ref: string
          to_team: string
          trade_id: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["trade_asset_type"]
          created_at?: string
          from_team: string
          id?: string
          keeper_clock_reset?: boolean
          ref: string
          to_team: string
          trade_id: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["trade_asset_type"]
          created_at?: string
          from_team?: string
          id?: string
          keeper_clock_reset?: boolean
          ref?: string
          to_team?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_assets_from_team_fkey"
            columns: ["from_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_assets_to_team_fkey"
            columns: ["to_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_assets_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      traded_picks: {
        Row: {
          created_at: string
          current_team: string
          from_team: string | null
          id: string
          original_team: string
          round: number
          season: number
          trade_id: string | null
        }
        Insert: {
          created_at?: string
          current_team: string
          from_team?: string | null
          id?: string
          original_team: string
          round: number
          season: number
          trade_id?: string | null
        }
        Update: {
          created_at?: string
          current_team?: string
          from_team?: string | null
          id?: string
          original_team?: string
          round?: number
          season?: number
          trade_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traded_picks_current_team_fkey"
            columns: ["current_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traded_picks_from_team_fkey"
            columns: ["from_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traded_picks_original_team_fkey"
            columns: ["original_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traded_picks_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          contingent: boolean
          created_at: string
          created_by: string | null
          executed_at: string | null
          id: string
          notes: string | null
          season: number
          source: string | null
          source_ref: string | null
          status: Database["public"]["Enums"]["trade_status"]
          traded_at: string | null
        }
        Insert: {
          contingent?: boolean
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          season: number
          source?: string | null
          source_ref?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
          traded_at?: string | null
        }
        Update: {
          contingent?: boolean
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          season?: number
          source?: string | null
          source_ref?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
          traded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_season_fkey"
            columns: ["season"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["season"]
          },
        ]
      }
      votes: {
        Row: {
          cast_at: string
          choice: Database["public"]["Enums"]["vote_choice"]
          id: string
          motion_id: string
          team_id: string
        }
        Insert: {
          cast_at?: string
          choice: Database["public"]["Enums"]["vote_choice"]
          id?: string
          motion_id: string
          team_id: string
        }
        Update: {
          cast_at?: string
          choice?: Database["public"]["Enums"]["vote_choice"]
          id?: string
          motion_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_motion_id_fkey"
            columns: ["motion_id"]
            isOneToOne: false
            referencedRelation: "motions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
      draft_status: "not_started" | "in_progress" | "paused" | "complete"
      keeper_status: "declared" | "confirmed" | "placed" | "withdrawn"
      motion_status:
        | "proposed"
        | "seconded"
        | "discussion"
        | "voting"
        | "ratified"
        | "rejected"
        | "withdrawn"
      motion_threshold:
        | "simple_majority"
        | "two_thirds"
        | "two_thirds_excl_subject"
        | "commissioner_ruling"
      officer_role: "commissioner" | "vice_commissioner" | "cto"
      officer_status: "active" | "inactive" | "removed"
      trade_asset_type: "player" | "pick" | "keeper_right" | "faab"
      trade_status: "proposed" | "accepted" | "vetoed" | "reversed"
      vote_choice: "for" | "against" | "abstain"
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
    Enums: {
      draft_status: ["not_started", "in_progress", "paused", "complete"],
      keeper_status: ["declared", "confirmed", "placed", "withdrawn"],
      motion_status: [
        "proposed",
        "seconded",
        "discussion",
        "voting",
        "ratified",
        "rejected",
        "withdrawn",
      ],
      motion_threshold: [
        "simple_majority",
        "two_thirds",
        "two_thirds_excl_subject",
        "commissioner_ruling",
      ],
      officer_role: ["commissioner", "vice_commissioner", "cto"],
      officer_status: ["active", "inactive", "removed"],
      trade_asset_type: ["player", "pick", "keeper_right", "faab"],
      trade_status: ["proposed", "accepted", "vetoed", "reversed"],
      vote_choice: ["for", "against", "abstain"],
    },
  },
} as const

// ---------------------------------------------------------------------------
// Named enum aliases
// ---------------------------------------------------------------------------
// The generator only emits the `Enums<"name">` lookup helper. These are the
// names the application imports, kept here so a regeneration is a copy-paste of
// the block above rather than a refactor of every call site.
//
// `npm run db:types` OVERWRITES THIS FILE, so this block has to be pasted back
// after every regeneration. Dropping it takes `next build` down — eight modules
// import these names — which is a production build failure rather than a
// warning. Check `npx tsc --noEmit` before committing a regenerated schema.

export type DraftStatus = Enums<"draft_status">;
export type KeeperStatus = Enums<"keeper_status">;
export type TradeStatus = Enums<"trade_status">;
export type TradeAssetType = Enums<"trade_asset_type">;
export type OfficerRole = Enums<"officer_role">;
export type OfficerStatus = Enums<"officer_status">;
export type MotionStatus = Enums<"motion_status">;
export type MotionThreshold = Enums<"motion_threshold">;
export type VoteChoice = Enums<"vote_choice">;
