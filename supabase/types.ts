export interface Database {
  public: {
    Tables: {
      campaigns: { Row: { id: string; name: string; created_at: string }; Insert: { id?: string; name: string }; Update: Partial<{ name: string }> };
      characters: {
        Row: { id: string; campaign_id: string; name: string; base_abilities: unknown; base_bab: number; base_saves: unknown; base_hp: number; skill_ranks: unknown; skill_configuration: unknown; current_hp: number; base_land_speed: number; created_at: string; updated_at: string };
        Insert: Partial<Database["public"]["Tables"]["characters"]["Row"]> & Pick<Database["public"]["Tables"]["characters"]["Row"], "id" | "campaign_id" | "name" | "base_abilities" | "base_bab" | "base_saves" | "base_hp" | "current_hp">;
        Update: Partial<Database["public"]["Tables"]["characters"]["Row"]>;
      };
      character_features: { Row: { character_id: string; id: string; definition_id: string | null; name: string; description: string | null; enabled: boolean; effects: unknown }; Insert: Omit<Database["public"]["Tables"]["character_features"]["Row"], "definition_id" | "description"> & { definition_id?: string | null; description?: string | null }; Update: Partial<Database["public"]["Tables"]["character_features"]["Row"]> };
      character_attacks: { Row: { character_id: string; id: string; definition: unknown }; Insert: Database["public"]["Tables"]["character_attacks"]["Row"]; Update: Partial<Database["public"]["Tables"]["character_attacks"]["Row"]> };
      roll_history: { Row: { id: string; campaign_id: string; character_id: string; roll_plan: unknown; faces: unknown; resolved: unknown; created_at: string }; Insert: Omit<Database["public"]["Tables"]["roll_history"]["Row"], "id" | "created_at">; Update: Partial<Database["public"]["Tables"]["roll_history"]["Row"]> };
    };
  };
}
