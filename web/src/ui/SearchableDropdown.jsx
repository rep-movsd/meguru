import { Component } from 'preact';

// Reusable search dropdown with keyboard navigation.
// Props:
//   value: string - current input value
//   options: [{symbol, name}, ...] - searchable options
//   onChange: (value) => void - called on input change or option select
//   onSubmit: () => void - called on Enter with no highlighted option
//   placeholder: string

class SearchableDropdown extends Component {
    constructor(props) {
        super(props);
        this.state = {
            isOpen: false,
            searchText: props.value || '',
            filteredOptions: [],
            highlightedIndex: -1
        };
        this.dropdownRef = null;
        this.optionsRef = [];
    }

    componentDidMount() {
        document.addEventListener('click', this.handleClickOutside);
        this.updateFilteredOptions(this.state.searchText);
    }

    componentWillUnmount() {
        document.removeEventListener('click', this.handleClickOutside);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.options !== this.props.options) {
            this.updateFilteredOptions(this.state.searchText);
        }
        if (prevProps.value !== this.props.value && this.props.value !== this.state.searchText) {
            this.setState({ searchText: this.props.value || '' });
        }
    }

    handleClickOutside = (e) => {
        if (this.dropdownRef && !this.dropdownRef.contains(e.target)) {
            this.setState({ isOpen: false, highlightedIndex: -1 });
        }
    }

    updateFilteredOptions = (searchText) => {
        const { options } = this.props;
        if (!options) {
            this.setState({ filteredOptions: [], highlightedIndex: -1 });
            return;
        }
        if (!searchText) {
            // Don't show the full list on empty search — too many items.
            // User must type at least 1 character to filter.
            this.setState({ filteredOptions: [], highlightedIndex: -1 });
            return;
        }

        const lower = searchText.toLowerCase();
        // Prioritise symbol-prefix matches, then include substring matches
        const prefixMatches = [];
        const otherMatches = [];
        for (const o of options) {
            if (o.symbol.toLowerCase().startsWith(lower)) {
                prefixMatches.push(o);
            } else if (o.symbol.toLowerCase().includes(lower) ||
                       o.name.toLowerCase().includes(lower)) {
                otherMatches.push(o);
            }
        }
        const filtered = prefixMatches.concat(otherMatches).slice(0, 100);

        this.setState({ filteredOptions: filtered, highlightedIndex: -1 });
    }

    handleInputChange = (e) => {
        const searchText = e.target.value;
        this.setState({ searchText, isOpen: true, highlightedIndex: -1 });
        this.updateFilteredOptions(searchText);
        if (this.props.onChange) this.props.onChange(searchText);
    }

    handleKeyDown = (e) => {
        const { isOpen, filteredOptions, highlightedIndex } = this.state;

        if (!isOpen) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.setState({ isOpen: true });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.props.onSubmit) this.props.onSubmit();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                {
                    const next = highlightedIndex < filteredOptions.length - 1
                        ? highlightedIndex + 1
                        : 0;
                    this.setState({ highlightedIndex: next });
                    this.scrollToOption(next);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                {
                    const prev = highlightedIndex > 0
                        ? highlightedIndex - 1
                        : filteredOptions.length - 1;
                    this.setState({ highlightedIndex: prev });
                    this.scrollToOption(prev);
                }
                break;

            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                    this.handleOptionSelect(filteredOptions[highlightedIndex]);
                } else {
                    this.setState({ isOpen: false, highlightedIndex: -1 });
                    if (this.props.onSubmit) this.props.onSubmit();
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.setState({ isOpen: false, highlightedIndex: -1 });
                break;
        }
    }

    scrollToOption = (index) => {
        if (this.optionsRef[index]) {
            this.optionsRef[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    handleOptionSelect = (option) => {
        this.setState({
            searchText: option.symbol,
            isOpen: false,
            highlightedIndex: -1
        });
        if (this.props.onChange) this.props.onChange(option.symbol);
    }

    handleInputFocus = () => {
        this.setState({ isOpen: true });
        this.updateFilteredOptions(this.state.searchText);
    }

    render() {
        const { placeholder } = this.props;
        const { isOpen, searchText, filteredOptions, highlightedIndex } = this.state;

        return (
            <div
                className="searchable-dropdown"
                ref={(el) => this.dropdownRef = el}
            >
                <input
                    type="text"
                    value={searchText}
                    onInput={this.handleInputChange}
                    onKeyDown={this.handleKeyDown}
                    onFocus={this.handleInputFocus}
                    placeholder={placeholder || 'Search...'}
                    autocomplete="off"
                    role="combobox"
                    aria-expanded={isOpen && filteredOptions.length > 0}
                    aria-autocomplete="list"
                    aria-controls="dropdown-listbox"
                    aria-activedescendant={highlightedIndex >= 0 ? `dropdown-option-${highlightedIndex}` : undefined}
                />
                {isOpen && filteredOptions.length > 0 && (
                    <div className="dropdown-options" id="dropdown-listbox" role="listbox">
                        {filteredOptions.map((option, index) => (
                            <div
                                key={option.symbol}
                                id={`dropdown-option-${index}`}
                                ref={(el) => this.optionsRef[index] = el}
                                className={`dropdown-option ${index === highlightedIndex ? 'highlighted' : ''}`}
                                role="option"
                                aria-selected={index === highlightedIndex}
                                onClick={() => this.handleOptionSelect(option)}
                                onMouseEnter={() => this.setState({ highlightedIndex: index })}
                            >
                                <span className="option-symbol">{option.symbol}</span>
                                <span className="option-name">{option.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
}

export default SearchableDropdown;
