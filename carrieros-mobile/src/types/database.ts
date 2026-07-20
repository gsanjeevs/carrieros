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
      carrier_details: {
        Row: {
          dot_number: string | null
          load_email: string | null
          mc_number: string | null
          org_id: number
          tier: string | null
          timezone: string | null
          uom_system: string | null
        }
        Insert: {
          dot_number?: string | null
          load_email?: string | null
          mc_number?: string | null
          org_id: number
          tier?: string | null
          timezone?: string | null
          uom_system?: string | null
        }
        Update: {
          dot_number?: string | null
          load_email?: string | null
          mc_number?: string | null
          org_id?: number
          tier?: string | null
          timezone?: string | null
          uom_system?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_details: {
        Row: {
          carrier_org_id: number
          contact_name: string | null
          customer_number: string | null
          notes: string | null
          org_id: number
          tags: string[] | null
        }
        Insert: {
          carrier_org_id: number
          contact_name?: string | null
          customer_number?: string | null
          notes?: string | null
          org_id: number
          tags?: string[] | null
        }
        Update: {
          carrier_org_id?: number
          contact_name?: string | null
          customer_number?: string | null
          notes?: string | null
          org_id?: number
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_details_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          id: number
          load_id: number | null
          storage_path: string
          type: string | null
          uploaded_by: string | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          load_id?: number | null
          storage_path: string
          type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          load_id?: number | null
          storage_path?: string
          type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          carrier_org_id: number
          cdl_class: string | null
          cdl_expiry: string | null
          cdl_number: string | null
          cdl_state: string | null
          created_at: string | null
          default_truck_id: number | null
          driver_number: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          endorsements: string[] | null
          id: number
          invite_status: string | null
          is_active: boolean | null
          med_cert_expiry: string | null
          profile_id: string
        }
        Insert: {
          carrier_org_id: number
          cdl_class?: string | null
          cdl_expiry?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string | null
          default_truck_id?: number | null
          driver_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          endorsements?: string[] | null
          id?: number
          invite_status?: string | null
          is_active?: boolean | null
          med_cert_expiry?: string | null
          profile_id: string
        }
        Update: {
          carrier_org_id?: number
          cdl_class?: string | null
          cdl_expiry?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string | null
          default_truck_id?: number | null
          driver_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          endorsements?: string[] | null
          id?: number
          invite_status?: string | null
          is_active?: boolean | null
          med_cert_expiry?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_default_truck_id_fkey"
            columns: ["default_truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dvir_defects: {
        Row: {
          area: string
          created_at: string | null
          description: string | null
          id: number
          inspection_id: number | null
          photo_path: string | null
          severity: string | null
        }
        Insert: {
          area: string
          created_at?: string | null
          description?: string | null
          id?: number
          inspection_id?: number | null
          photo_path?: string | null
          severity?: string | null
        }
        Update: {
          area?: string
          created_at?: string | null
          description?: string | null
          id?: number
          inspection_id?: number | null
          photo_path?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dvir_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "dvir_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      dvir_inspections: {
        Row: {
          carrier_org_id: number | null
          condition: string
          created_at: string | null
          driver_id: number | null
          id: number
          load_id: number | null
          odometer: number | null
          signature_url: string | null
          submitted_at: string | null
          truck_id: number | null
          type: string
        }
        Insert: {
          carrier_org_id?: number | null
          condition: string
          created_at?: string | null
          driver_id?: number | null
          id?: number
          load_id?: number | null
          odometer?: number | null
          signature_url?: string | null
          submitted_at?: string | null
          truck_id?: number | null
          type: string
        }
        Update: {
          carrier_org_id?: number | null
          condition?: string
          created_at?: string | null
          driver_id?: number | null
          id?: number
          load_id?: number | null
          odometer?: number | null
          signature_url?: string | null
          submitted_at?: string | null
          truck_id?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "dvir_inspections_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          carrier_org_id: number
          created_at: string | null
          customer_org_id: number | null
          due_date: string | null
          id: number
          invoice_number: string
          load_id: number | null
          notes: string | null
          paid_at: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          amount: number
          carrier_org_id: number
          created_at?: string | null
          customer_org_id?: number | null
          due_date?: string | null
          id?: number
          invoice_number: string
          load_id?: number | null
          notes?: string | null
          paid_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          carrier_org_id?: number
          created_at?: string | null
          customer_org_id?: number | null
          due_date?: string | null
          id?: number
          invoice_number?: string
          load_id?: number | null
          notes?: string | null
          paid_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
        ]
      }
      load_events: {
        Row: {
          created_at: string | null
          created_by: string | null
          event_type: string
          id: number
          load_id: number
          location_lat: number | null
          location_lng: number | null
          note: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          event_type: string
          id?: number
          load_id: number
          location_lat?: number | null
          location_lng?: number | null
          note?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          id?: number
          load_id?: number
          location_lat?: number | null
          location_lng?: number | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "load_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          carrier_org_id: number
          commodity: string | null
          created_at: string | null
          customer_name_raw: string | null
          customer_org_id: number | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_date: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_state: string | null
          delivery_time: string | null
          delivery_zip: string | null
          driver_id: number | null
          extraction_data: Json | null
          id: number
          intake_method: string | null
          last_location_at: string | null
          last_location_lat: number | null
          last_location_lng: number | null
          load_number: string
          pickup_address: string | null
          pickup_city: string | null
          pickup_date: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_state: string | null
          pickup_time: string | null
          pickup_zip: string | null
          rate: number | null
          raw_intake_text: string | null
          status: string | null
          total_miles: number | null
          tracking_token: string | null
          truck_id: number | null
          updated_at: string | null
          weight_lbs: number | null
        }
        Insert: {
          carrier_org_id: number
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          extraction_data?: Json | null
          id?: number
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number: string
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          rate?: number | null
          raw_intake_text?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Update: {
          carrier_org_id?: number
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          extraction_data?: Json | null
          id?: number
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          rate?: number | null
          raw_intake_text?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_reminders: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          id: number
          is_active: boolean | null
          last_odometer: number | null
          last_service_date: string | null
          next_due_date: string | null
          next_due_miles: number | null
          reminder_type: string
          trigger_miles: number | null
          trigger_months: number | null
          truck_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          last_odometer?: number | null
          last_service_date?: string | null
          next_due_date?: string | null
          next_due_miles?: number | null
          reminder_type: string
          trigger_miles?: number | null
          trigger_months?: number | null
          truck_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          last_odometer?: number | null
          last_service_date?: string | null
          next_due_date?: string | null
          next_due_miles?: number | null
          reminder_type?: string
          trigger_miles?: number | null
          trigger_months?: number | null
          truck_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_reminders_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reminders_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      org_documents: {
        Row: {
          created_at: string | null
          doc_type: string
          expiry_date: string | null
          id: number
          label: string | null
          org_id: number | null
          storage_path: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          doc_type: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          org_id?: number | null
          storage_path: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          doc_type?: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          org_id?: number | null
          storage_path?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_sequences: {
        Row: {
          entity: string
          last_val: number | null
          org_id: number
        }
        Insert: {
          entity: string
          last_val?: number | null
          org_id: number
        }
        Update: {
          entity?: string
          last_val?: number | null
          org_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          email: string | null
          id: number
          name: string
          phone: string | null
          state: string | null
          type: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: number
          name: string
          phone?: string | null
          state?: string | null
          type: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: number
          name?: string
          phone?: string | null
          state?: string | null
          type?: string
          zip?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          org_id: number
          phone: string | null
          preferred_language: string | null
          role: string
          timezone: string | null
        }
        Insert: {
          created_at?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          org_id: number
          phone?: string | null
          preferred_language?: string | null
          role: string
          timezone?: string | null
        }
        Update: {
          created_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          org_id?: number
          phone?: string | null
          preferred_language?: string | null
          role?: string
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_logs: {
        Row: {
          carrier_org_id: number | null
          cost: number | null
          created_at: string | null
          id: number
          logged_by: string | null
          notes: string | null
          odometer: number | null
          service_date: string
          service_type: string
          shop_name: string | null
          truck_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          cost?: number | null
          created_at?: string | null
          id?: number
          logged_by?: string | null
          notes?: string | null
          odometer?: number | null
          service_date: string
          service_type: string
          shop_name?: string | null
          truck_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          cost?: number | null
          created_at?: string | null
          id?: number
          logged_by?: string | null
          notes?: string | null
          odometer?: number | null
          service_date?: string
          service_type?: string
          shop_name?: string | null
          truck_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_logs_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      truck_documents: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          doc_type: string
          expiry_date: string | null
          id: number
          label: string | null
          storage_path: string
          truck_id: number | null
          uploaded_by: string | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path: string
          truck_id?: number | null
          uploaded_by?: string | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type?: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path?: string
          truck_id?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "truck_documents_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trucks: {
        Row: {
          carrier_org_id: number
          created_at: string | null
          id: number
          is_active: boolean | null
          license_plate: string | null
          license_state: string | null
          make: string | null
          model: string | null
          nickname: string
          truck_number: string | null
          vin: string | null
          year: number | null
        }
        Insert: {
          carrier_org_id: number
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          license_plate?: string | null
          license_state?: string | null
          make?: string | null
          model?: string | null
          nickname: string
          truck_number?: string | null
          vin?: string | null
          year?: number | null
        }
        Update: {
          carrier_org_id?: number
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          license_plate?: string | null
          license_state?: string | null
          make?: string | null
          model?: string | null
          nickname?: string
          truck_number?: string | null
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trucks_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      loads_driver_view: {
        Row: {
          carrier_org_id: number | null
          commodity: string | null
          created_at: string | null
          customer_name_raw: string | null
          customer_org_id: number | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_date: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_state: string | null
          delivery_time: string | null
          delivery_zip: string | null
          driver_id: number | null
          id: number | null
          intake_method: string | null
          last_location_at: string | null
          last_location_lat: number | null
          last_location_lng: number | null
          load_number: string | null
          pickup_address: string | null
          pickup_city: string | null
          pickup_date: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_state: string | null
          pickup_time: string | null
          pickup_zip: string | null
          status: string | null
          total_miles: number | null
          tracking_token: string | null
          truck_id: number | null
          updated_at: string | null
          weight_lbs: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          id?: number | null
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          id?: number | null
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_customer_org: {
        Args: {
          p_address?: string
          p_city?: string
          p_contact_name?: string
          p_country?: string
          p_email?: string
          p_name: string
          p_notes?: string
          p_phone?: string
          p_state?: string
          p_zip?: string
        }
        Returns: {
          customer_number: string
          name: string
          org_id: number
        }[]
      }
      get_public_tracking: {
        Args: { p_token: string }
        Returns: {
          carrier_email: string
          carrier_name: string
          carrier_phone: string
          delivery_city: string
          delivery_date: string
          delivery_state: string
          last_location_at: string
          last_location_lat: number
          last_location_lng: number
          load_number: string
          pickup_city: string
          pickup_date: string
          pickup_state: string
          status: string
        }[]
      }
      my_org_id: { Args: never; Returns: number }
      my_role: { Args: never; Returns: string }
      next_entity_val: {
        Args: { carrier_org_bigint: number; entity_name: string }
        Returns: number
      }
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

