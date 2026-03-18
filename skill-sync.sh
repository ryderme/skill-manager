#!/bin/bash
# skill-sync.sh — 统一 skill 软链接管理器
# 自动发现 SKILLS_DIR 下所有 SKILL.md，为各工具创建软链接
# 工具列表从 tools.json 读取，添加新工具只需编辑该文件
#
# 用法:
#   ./skill-sync.sh          # 同步所有 skill
#   ./skill-sync.sh status   # 查看当前状态
#   ./skill-sync.sh clean    # 清理失效的软链接

set -euo pipefail

# ── 配置（从 tools.json 读取） ────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/tools.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "错误: 未找到 $CONFIG_FILE" >&2
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "错误: 需要 python3 来解析 tools.json" >&2
  exit 1
fi

expand_home() {
  echo "${1/\~/$HOME}"
}

# 读取 tools.json
_RAW_SKILLS_DIR=$(python3 -c "import json; d=json.load(open('$CONFIG_FILE')); print(d.get('skillsDir','~/github'))")
_RAW_EXCLUDES=$(python3 -c "import json; d=json.load(open('$CONFIG_FILE')); print(','.join(d.get('excludeProjects',[])))")

GITHUB_DIR=$(expand_home "${SKILLS_DIR:-$_RAW_SKILLS_DIR}")

# 构建 TOOL_DIRS（环境变量优先于 tools.json）
declare -A TOOL_DIRS=()
while IFS='=' read -r name dir; do
  env_key="${name^^}_SKILLS"
  resolved="${!env_key:-$(expand_home "$dir")}"
  TOOL_DIRS[$name]="$resolved"
done < <(python3 -c "
import json
d = json.load(open('$CONFIG_FILE'))
for k, v in d.get('tools', {}).items():
    print(f'{k}={v}')
")

# 排除列表（环境变量优先）
IFS=',' read -ra EXCLUDE_PROJECTS <<< "${EXCLUDE_PROJECTS:-$_RAW_EXCLUDES}"

# ── 颜色 ──────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

# ── 工具函数 ──────────────────────────────────────────────────────────────────

log_info()    { echo -e "${BLUE}[sync]${NC} $*"; }
log_ok()      { echo -e "${GREEN}[ok]${NC}   $*"; }
log_warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
log_skip()    { echo -e "${DIM}[skip]  $*${NC}"; }
log_err()     { echo -e "${RED}[err]${NC}   $*"; }

# 构建 find 排除参数
build_exclude_args() {
  local args=()
  for proj in "${EXCLUDE_PROJECTS[@]}"; do
    args+=(-not -path "*/$proj/*")
  done
  echo "${args[@]}"
}

# 发现所有 skill 目录（包含 SKILL.md 的目录）
discover_skills() {
  local exclude_args
  exclude_args=$(build_exclude_args)

  # shellcheck disable=SC2086
  find "$GITHUB_DIR" -name "SKILL.md" $exclude_args -print0 \
    | xargs -0 -I{} dirname {} \
    | sort -u
}

# ── 主命令 ────────────────────────────────────────────────────────────────────

cmd_sync() {
  local linked=0 skipped=0 created=0

  log_info "扫描 $GITHUB_DIR ..."
  local skills=()
  while IFS= read -r skill_dir; do
    skills+=("$skill_dir")
  done < <(discover_skills)

  log_info "发现 ${#skills[@]} 个 skill，同步到 ${!TOOL_DIRS[*]}"
  echo ""

  # 检查名称冲突
  declare -A seen_names=()
  for skill_dir in "${skills[@]}"; do
    skill_name=$(basename "$skill_dir")
    if [[ -n "${seen_names[$skill_name]+_}" ]]; then
      log_warn "名称冲突: '$skill_name'"
      log_warn "  已有: ${seen_names[$skill_name]}"
      log_warn "  重复: $skill_dir"
      log_warn "  → 跳过重复项，请手动处理"
      continue
    fi
    seen_names[$skill_name]="$skill_dir"
  done

  for skill_dir in "${skills[@]}"; do
    skill_name=$(basename "$skill_dir")

    # 跳过冲突项（非第一个）
    if [[ "${seen_names[$skill_name]}" != "$skill_dir" ]]; then
      continue
    fi

    for tool in "${!TOOL_DIRS[@]}"; do
      tool_dir="${TOOL_DIRS[$tool]}"
      target="$tool_dir/$skill_name"

      # 确保工具目录存在
      mkdir -p "$tool_dir"

      if [[ -L "$target" ]]; then
        current_target=$(readlink "$target")
        if [[ "$current_target" == "$skill_dir" ]]; then
          ((skipped++)) || true
          log_skip "$tool/$skill_name"
        else
          log_warn "$tool/$skill_name 指向不同路径"
          log_warn "  当前: $current_target"
          log_warn "  期望: $skill_dir"
          log_warn "  → 使用 'update' 参数强制更新"
        fi
      elif [[ -e "$target" ]]; then
        log_warn "$tool/$skill_name 已存在（非软链接），跳过"
      else
        ln -s "$skill_dir" "$target"
        ((created++)) || true
        log_ok "新建 $tool/$skill_name"
      fi
    done
  done

  echo ""
  log_info "完成: 新建 $created，已有 $skipped"
}

cmd_update() {
  log_info "强制更新所有软链接..."
  local skills=()
  while IFS= read -r skill_dir; do
    skills+=("$skill_dir")
  done < <(discover_skills)

  for skill_dir in "${skills[@]}"; do
    skill_name=$(basename "$skill_dir")
    for tool in "${!TOOL_DIRS[@]}"; do
      tool_dir="${TOOL_DIRS[$tool]}"
      target="$tool_dir/$skill_name"
      mkdir -p "$tool_dir"
      ln -sfn "$skill_dir" "$target"
      log_ok "更新 $tool/$skill_name → $skill_dir"
    done
  done
}

cmd_status() {
  echo ""
  echo -e "${BLUE}── 已发现的 Skills ────────────────────────────────${NC}"

  local skills=()
  while IFS= read -r skill_dir; do
    skills+=("$skill_dir")
  done < <(discover_skills)

  printf "%-40s" "Skill"
  for tool in "${!TOOL_DIRS[@]}"; do
    printf "%-14s" "$tool"
  done
  echo ""
  printf "%-40s" "──────────────────────────────────────"
  for tool in "${!TOOL_DIRS[@]}"; do
    printf "%-14s" "──────────────"
  done
  echo ""

  for skill_dir in "${skills[@]}"; do
    skill_name=$(basename "$skill_dir")
    printf "%-40s" "$skill_name"
    for tool in "${!TOOL_DIRS[@]}"; do
      tool_dir="${TOOL_DIRS[$tool]}"
      target="$tool_dir/$skill_name"
      if [[ -L "$target" && "$(readlink "$target")" == "$skill_dir" ]]; then
        printf "${GREEN}%-14s${NC}" "✓ linked"
      elif [[ -L "$target" ]]; then
        printf "${YELLOW}%-14s${NC}" "⚠ wrong link"
      else
        printf "${RED}%-14s${NC}" "✗ missing"
      fi
    done
    echo ""
  done

  echo ""
  echo -e "${DIM}共 ${#skills[@]} 个 skill${NC}"
  echo ""
}

cmd_clean() {
  log_info "清理失效软链接..."
  local cleaned=0
  for tool in "${!TOOL_DIRS[@]}"; do
    tool_dir="${TOOL_DIRS[$tool]}"
    [[ -d "$tool_dir" ]] || continue
    while IFS= read -r link; do
      if [[ ! -e "$link" ]]; then
        rm "$link"
        ((cleaned++)) || true
        log_ok "删除失效链接: $link"
      fi
    done < <(find "$tool_dir" -maxdepth 1 -type l)
  done
  log_info "清理完成，删除 $cleaned 个失效链接"
}

# ── 入口 ──────────────────────────────────────────────────────────────────────

case "${1:-sync}" in
  sync)   cmd_sync ;;
  update) cmd_update ;;
  status) cmd_status ;;
  clean)  cmd_clean ;;
  *)
    echo "用法: $0 [sync|update|status|clean]"
    echo ""
    echo "  sync    新建缺失的软链接（默认）"
    echo "  update  强制更新所有软链接"
    echo "  status  查看所有 skill 的链接状态"
    echo "  clean   清理失效的软链接"
    exit 1
    ;;
esac
