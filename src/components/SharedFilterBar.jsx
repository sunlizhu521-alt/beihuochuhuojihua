import { memo, useMemo } from 'react';

const SharedFilterDropdown = memo(function SharedFilterDropdown({
  filter,
  selectedValues,
  onChange
}) {
  const { key, label, options = [], multiSelect = true } = filter;
  const normalizedOptions = useMemo(() => (
    [...new Set([...selectedValues, ...options].map((value) => String(value || '').trim()).filter(Boolean))]
  ), [options, selectedValues]);
  const visibleSelected = selectedValues.slice(0, 2);

  function toggleOption(option) {
    const selected = selectedValues.includes(option);
    const nextValues = multiSelect
      ? (selected ? selectedValues.filter((value) => value !== option) : [...selectedValues, option])
      : (selected ? [] : [option]);
    onChange(key, nextValues);
  }

  return (
    <div className="shared-filter-field">
      <span>{label}</span>
      <details className="shared-filter-dropdown">
        <summary aria-label={label}>
          <span className="shared-filter-selected-values">
            {visibleSelected.length ? visibleSelected.map((value) => (
              <span className="shared-filter-selected-tag" key={value}>{value}</span>
            )) : <span className="shared-filter-all">全部{label}</span>}
            {selectedValues.length > visibleSelected.length ? (
              <span className="shared-filter-selected-count">+{selectedValues.length - visibleSelected.length}</span>
            ) : null}
          </span>
        </summary>
        <div className="shared-filter-options" role="group" aria-label={`${label}选项`}>
          {normalizedOptions.length ? normalizedOptions.map((option) => (
            <label key={option}>
              <input
                type={multiSelect ? 'checkbox' : 'radio'}
                name={multiSelect ? undefined : `shared-filter-${key}`}
                aria-label={`${label}：${option}`}
                checked={selectedValues.includes(option)}
                onChange={() => toggleOption(option)}
              />
              <span>{option}</span>
            </label>
          )) : <span className="shared-filter-empty">暂无选项</span>}
        </div>
      </details>
    </div>
  );
});

const SharedFilterBar = memo(function SharedFilterBar({
  filters = [],
  values = {},
  onChange,
  onClear,
  ariaLabel = '筛选器',
  status = ''
}) {
  const normalizedValues = useMemo(() => Object.fromEntries(filters.map(({ key }) => {
    const value = values[key];
    return [key, Array.isArray(value) ? value : (value ? [value] : [])];
  })), [filters, values]);
  const hasSelection = filters.some(({ key }) => normalizedValues[key].length > 0);

  function clearFilters() {
    if (onClear) {
      onClear();
      return;
    }
    filters.forEach(({ key }) => onChange(key, []));
  }

  return (
    <section className="shared-filter-bar" aria-label={ariaLabel}>
      {filters.map((filter) => (
        <SharedFilterDropdown
          key={filter.key}
          filter={filter}
          selectedValues={normalizedValues[filter.key]}
          onChange={onChange}
        />
      ))}
      <button type="button" className="ghost shared-filter-clear" disabled={!hasSelection} onClick={clearFilters}>
        清空筛选
      </button>
      {status ? <span className="shared-filter-status" role="status">{status}</span> : null}
    </section>
  );
});

export default SharedFilterBar;
