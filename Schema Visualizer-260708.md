## Table `alembic_version`

### Columns

| Name          | Type      | Constraints |
| ------------- | --------- | ----------- |
| `version_num` | `varchar` | Primary     |

## Table `sources`

### Columns

| Name       | Type      | Constraints |
| ---------- | --------- | ----------- |
| `id`       | `int4`    | Primary     |
| `name`     | `varchar` | Unique      |
| `base_url` | `text`    | Nullable    |

## Table `daily_runs`

### Columns

| Name             | Type      | Constraints |
| ---------------- | --------- | ----------- |
| `run_date`       | `date`    | Primary     |
| `source_id`      | `int4`    | Primary     |
| `total`          | `int4`    |             |
| `high`           | `int4`    |             |
| `mid`            | `int4`    |             |
| `low`            | `int4`    |             |
| `urgent`         | `int4`    |             |
| `priority`       | `int4`    |             |
| `budget_sum_wan` | `int8`    |             |
| `summary`        | `text`    | Nullable    |
| `report_file`    | `varchar` | Nullable    |

## Table `tenders`

### Columns

| Name                  | Type          | Constraints |
| --------------------- | ------------- | ----------- |
| `id`                  | `int4`        | Primary     |
| `source_id`           | `int4`        |             |
| `case_pk`             | `varchar`     |             |
| `name`                | `text`        |             |
| `org`                 | `text`        | Nullable    |
| `category`            | `varchar`     | Nullable    |
| `budget_wan`          | `int4`        | Nullable    |
| `deadline_roc`        | `varchar`     | Nullable    |
| `deadline_iso`        | `date`        | Nullable    |
| `tender_method`       | `varchar`     | Nullable    |
| `city`                | `varchar`     | Nullable    |
| `link`                | `text`        | Nullable    |
| `first_seen`          | `date`        | Nullable    |
| `last_seen`           | `date`        | Nullable    |
| `current_revision_id` | `int4`        | Nullable    |
| `detail_checked_at`   | `timestamptz` | Nullable    |
| `annotations`         | `jsonb`       | Nullable    |
| `feasibility_team`    | `int4`        | Nullable    |

## Table `daily_tender`

### Columns

| Name        | Type      | Constraints |
| ----------- | --------- | ----------- |
| `run_date`  | `date`    | Primary     |
| `tender_id` | `int4`    | Primary     |
| `tier`      | `varchar` | Nullable    |
| `days_left` | `int4`    | Nullable    |

## Table `users`

### Columns

| Name               | Type          | Constraints     |
| ------------------ | ------------- | --------------- |
| `id`               | `int4`        | Primary         |
| `name`             | `varchar`     |                 |
| `email`            | `varchar`     | Nullable Unique |
| `role`             | `varchar`     | Nullable        |
| `created_at`       | `timestamptz` |                 |
| `whitelist_active` | `bool`        |                 |
| `consent_shared`   | `bool`        |                 |
| `consent_at`       | `timestamptz` | Nullable        |
| `password_hash`    | `varchar`     | Nullable        |

## Table `saved_searches`

### Columns

| Name          | Type          | Constraints |
| ------------- | ------------- | ----------- |
| `id`          | `int4`        | Primary     |
| `user_id`     | `int4`        |             |
| `name`        | `varchar`     |             |
| `query_text`  | `text`        | Nullable    |
| `filter_json` | `jsonb`       | Nullable    |
| `use_count`   | `int4`        |             |
| `created_at`  | `timestamptz` |             |

## Table `annotations`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `id`         | `int4`        | Primary     |
| `user_id`    | `int4`        |             |
| `tender_id`  | `int4`        |             |
| `note`       | `text`        |             |
| `created_at` | `timestamptz` |             |

## Table `evaluations`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `id`         | `int4`        | Primary     |
| `user_id`    | `int4`        |             |
| `tender_id`  | `int4`        |             |
| `feasible`   | `varchar`     | Nullable    |
| `criteria`   | `jsonb`       | Nullable    |
| `rationale`  | `text`        | Nullable    |
| `created_at` | `timestamptz` |             |

## Table `events`

### Columns

| Name        | Type          | Constraints |
| ----------- | ------------- | ----------- |
| `id`        | `int4`        | Primary     |
| `user_id`   | `int4`        |             |
| `ts`        | `timestamptz` |             |
| `type`      | `varchar`     |             |
| `tender_id` | `int4`        | Nullable    |
| `payload`   | `jsonb`       | Nullable    |

## Table `shares`

### Columns

| Name        | Type          | Constraints |
| ----------- | ------------- | ----------- |
| `id`        | `int4`        | Primary     |
| `user_id`   | `int4`        |             |
| `tender_id` | `int4`        |             |
| `channel`   | `varchar`     | Nullable    |
| `ts`        | `timestamptz` |             |

## Table `tender_user_state`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `user_id`    | `int4`        | Primary     |
| `tender_id`  | `int4`        | Primary     |
| `saved`      | `bool`        |             |
| `status`     | `varchar`     | Nullable    |
| `star`       | `int4`        | Nullable    |
| `updated_at` | `timestamptz` |             |

## Table `tender_vectors`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `tender_id`  | `int4`        | Primary     |
| `embedding`  | `vector`      |             |
| `model`      | `varchar`     |             |
| `content`    | `text`        |             |
| `updated_at` | `timestamptz` |             |

## Table `tender_snapshots`

### Columns

| Name                  | Type          | Constraints |
| --------------------- | ------------- | ----------- |
| `id`                  | `int4`        | Primary     |
| `tender_id`           | `int4`        |             |
| `source_url`          | `text`        | Nullable    |
| `http_status`         | `int4`        | Nullable    |
| `content_type`        | `varchar`     | Nullable    |
| `content_hash`        | `varchar`     |             |
| `source_revision_key` | `varchar`     | Nullable    |
| `raw_html`            | `text`        |             |
| `storage_uri`         | `text`        | Nullable    |
| `fetched_at`          | `timestamptz` |             |
| `created_at`          | `timestamptz` |             |

## Table `tender_revisions`

### Columns

| Name                   | Type          | Constraints |
| ---------------------- | ------------- | ----------- |
| `id`                   | `int4`        | Primary     |
| `tender_id`            | `int4`        |             |
| `snapshot_id`          | `int4`        |             |
| `revision_no`          | `int4`        |             |
| `content_hash`         | `varchar`     |             |
| `source_revision_key`  | `varchar`     | Nullable    |
| `award_method`         | `varchar`     | Nullable    |
| `deposit_required`     | `bool`        | Nullable    |
| `deposit_amount_twd`   | `int8`        | Nullable    |
| `deposit_raw_text`     | `text`        | Nullable    |
| `qualification_codes`  | `jsonb`       | Nullable    |
| `qualification_text`   | `text`        | Nullable    |
| `category_main`        | `varchar`     | Nullable    |
| `category_code`        | `varchar`     | Nullable    |
| `category_name`        | `text`        | Nullable    |
| `category_raw`         | `text`        | Nullable    |
| `performance_period`   | `text`        | Nullable    |
| `performance_location` | `text`        | Nullable    |
| `subsidy_source`       | `text`        | Nullable    |
| `extra_note`           | `text`        | Nullable    |
| `raw_fields`           | `jsonb`       | Nullable    |
| `fetched_at`           | `timestamptz` |             |
| `created_at`           | `timestamptz` |             |
| `attachments`          | `jsonb`       | Nullable    |
| `annotations`          | `jsonb`       | Nullable    |
| `qualification_items`  | `jsonb`       | Nullable    |

## Table `crawl_runs`

### Columns

| Name            | Type          | Constraints |
| --------------- | ------------- | ----------- |
| `id`            | `int4`        | Primary     |
| `trigger`       | `varchar`     |             |
| `started_at`    | `timestamptz` |             |
| `finished_at`   | `timestamptz` | Nullable    |
| `targeted`      | `int4`        |             |
| `fetched`       | `int4`        |             |
| `unchanged`     | `int4`        |             |
| `new_revisions` | `int4`        |             |
| `failed`        | `int4`        |             |
| `status`        | `varchar`     |             |
| `notes`         | `jsonb`       | Nullable    |

## Table `crawl_failures`

### Columns

| Name               | Type          | Constraints |
| ------------------ | ------------- | ----------- |
| `id`               | `int4`        | Primary     |
| `crawl_run_id`     | `int4`        | Nullable    |
| `tender_id`        | `int4`        |             |
| `stage`            | `varchar`     |             |
| `http_status`      | `int4`        | Nullable    |
| `error_class`      | `varchar`     | Nullable    |
| `error_detail`     | `text`        | Nullable    |
| `attempt`          | `int4`        |             |
| `retriable`        | `bool`        |             |
| `next_retry_after` | `timestamptz` | Nullable    |
| `resolved_at`      | `timestamptz` | Nullable    |
| `created_at`       | `timestamptz` |             |

## Table `keyword_weights`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `term`       | `varchar`     | Primary     |
| `polarity`   | `varchar`     |             |
| `weight`     | `float8`      |             |
| `support`    | `int4`        |             |
| `notes`      | `text`        | Nullable    |
| `updated_at` | `timestamptz` |             |

## Table `doc_summaries`

### Columns

| Name             | Type          | Constraints |
| ---------------- | ------------- | ----------- |
| `tender_id`      | `int4`        | Primary     |
| `summary`        | `text`        | Nullable    |
| `key_terms`      | `text`        | Nullable    |
| `source_doc_url` | `text`        | Nullable    |
| `created_at`     | `timestamptz` |             |
| `updated_at`     | `timestamptz` |             |

## Table `decision_vectors`

### Columns

| Name            | Type          | Constraints |
| --------------- | ------------- | ----------- |
| `evaluation_id` | `int4`        | Primary     |
| `tender_id`     | `int4`        |             |
| `model`         | `varchar`     |             |
| `embedding`     | `vector`      |             |
| `content`       | `text`        |             |
| `feasible`      | `varchar`     |             |
| `updated_at`    | `timestamptz` |             |

## Table `keyword_weight_revisions`

### Columns

| Name                 | Type          | Constraints |
| -------------------- | ------------- | ----------- |
| `id`                 | `int4`        | Primary     |
| `batch`              | `varchar`     |             |
| `term`               | `varchar`     |             |
| `polarity`           | `varchar`     |             |
| `weight`             | `float8`      |             |
| `support`            | `int4`        |             |
| `feasible_samples`   | `int4`        |             |
| `infeasible_samples` | `int4`        |             |
| `created_at`         | `timestamptz` |             |

## Table `knowledge_chunks`

### Columns

| Name          | Type          | Constraints |
| ------------- | ------------- | ----------- |
| `id`          | `int4`        | Primary     |
| `doc_id`      | `varchar`     |             |
| `title`       | `varchar`     |             |
| `heading`     | `varchar`     | Nullable    |
| `chunk_index` | `int4`        |             |
| `content`     | `text`        |             |
| `tokens`      | `text`        |             |
| `embedding`   | `vector`      |             |
| `model`       | `varchar`     |             |
| `updated_at`  | `timestamptz` |             |

## Table `push_logs`

### Columns

| Name        | Type          | Constraints |
| ----------- | ------------- | ----------- |
| `id`        | `int4`        | Primary     |
| `user_id`   | `int4`        |             |
| `tender_id` | `int4`        | Nullable    |
| `run_date`  | `date`        |             |
| `score`     | `int4`        | Nullable    |
| `tier`      | `varchar`     | Nullable    |
| `reason`    | `text`        | Nullable    |
| `channel`   | `varchar`     |             |
| `status`    | `varchar`     |             |
| `pushed_at` | `timestamptz` |             |
| `read_at`   | `timestamptz` | Nullable    |

## Table `evolution_logs`

### Columns

| Name                  | Type          | Constraints |
| --------------------- | ------------- | ----------- |
| `id`                  | `int4`        | Primary     |
| `batch`               | `varchar`     |             |
| `trigger`             | `varchar`     |             |
| `feasible_samples`    | `int4`        |             |
| `infeasible_samples`  | `int4`        |             |
| `keywords_added`      | `int4`        |             |
| `keywords_updated`    | `int4`        |             |
| `revision_rows`       | `int4`        |             |
| `top_positive`        | `jsonb`       | Nullable    |
| `top_negative`        | `jsonb`       | Nullable    |
| `signals`             | `jsonb`       | Nullable    |
| `created_at`          | `timestamptz` |             |
| `negative_candidates` | `jsonb`       | Nullable    |

## Table `preference_profiles`

### Columns

| Name                   | Type          | Constraints |
| ---------------------- | ------------- | ----------- |
| `id`                   | `int4`        | Primary     |
| `user_id`              | `int4`        | Unique      |
| `top_keywords`         | `jsonb`       | Nullable    |
| `avoid_keywords`       | `jsonb`       | Nullable    |
| `preferred_categories` | `jsonb`       | Nullable    |
| `budget_min`           | `int4`        | Nullable    |
| `budget_max`           | `int4`        | Nullable    |
| `updated_at`           | `timestamptz` |             |

## Table `user_keyword_weights`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `user_id`    | `int4`        | Primary     |
| `term`       | `varchar`     | Primary     |
| `polarity`   | `varchar`     |             |
| `weight`     | `float8`      |             |
| `support`    | `int4`        |             |
| `updated_at` | `timestamptz` |             |

## Table `assistant_threads`

### Columns

| Name             | Type          | Constraints |
| ---------------- | ------------- | ----------- |
| `id`             | `varchar`     | Primary     |
| `owner_user_id`  | `varchar`     |             |
| `scope`          | `varchar`     |             |
| `title`          | `varchar`     | Nullable    |
| `consent_state`  | `varchar`     |             |
| `layer_b_opt_in` | `bool`        |             |
| `created_at`     | `timestamptz` |             |
| `updated_at`     | `timestamptz` |             |

## Table `assistant_messages`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `id`         | `int4`        | Primary     |
| `thread_id`  | `varchar`     |             |
| `role`       | `varchar`     |             |
| `content`    | `text`        |             |
| `sources`    | `jsonb`       | Nullable    |
| `created_at` | `timestamptz` |             |

## Table `assistant_brain_config`

### Columns

| Name            | Type          | Constraints |
| --------------- | ------------- | ----------- |
| `id`            | `int4`        | Primary     |
| `provider`      | `varchar`     |             |
| `ollama_model`  | `varchar`     | Nullable    |
| `cli_agent`     | `varchar`     | Nullable    |
| `byok_protocol` | `varchar`     | Nullable    |
| `byok_base_url` | `varchar`     | Nullable    |
| `byok_model`    | `varchar`     | Nullable    |
| `byok_key_set`  | `bool`        |             |
| `updated_at`    | `timestamptz` |             |
| `cli_model`     | `varchar`     | Nullable    |

## Table `user_manual_keywords`

### Columns

| Name         | Type          | Constraints |
| ------------ | ------------- | ----------- |
| `user_id`    | `int4`        | Primary     |
| `term`       | `varchar`     | Primary     |
| `kind`       | `varchar`     | Primary     |
| `excluded`   | `bool`        |             |
| `created_at` | `timestamptz` |             |
| `updated_at` | `timestamptz` |             |

## Table `detail_field_visibility_config`

### Columns

| Name            | Type          | Constraints |
| --------------- | ------------- | ----------- |
| `id`            | `int4`        | Primary     |
| `hidden_fields` | `jsonb`       |             |
| `updated_at`    | `timestamptz` |             |

## Table `tier_threshold_revisions`

### Columns

| Name                 | Type          | Constraints |
| -------------------- | ------------- | ----------- |
| `id`                 | `int4`        | Primary     |
| `batch`              | `varchar`     |             |
| `c_high`             | `int4`        |             |
| `c_low`              | `int4`        |             |
| `target_high`        | `float8`      |             |
| `target_low`         | `float8`      |             |
| `min_support`        | `int4`        |             |
| `support_high`       | `int4`        |             |
| `support_low`        | `int4`        |             |
| `feasible_samples`   | `int4`        |             |
| `infeasible_samples` | `int4`        |             |
| `fallback`           | `bool`        |             |
| `created_at`         | `timestamptz` |             |