// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract TestSwapAdapter {
    address public immutable owner;

    mapping(address => mapping(address => uint256)) private rates;
    mapping(address => uint256) public liquidity;

    event Swap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn) external {
        uint256 rate = rates[tokenIn][tokenOut];
        require(rate != 0, "rate not set");

        uint256 amountOut = (amountIn * rate) / 1e18;
        require(amountOut > 0, "zero output amount");

        uint256 available = liquidity[tokenOut];
        require(available >= amountOut, "insufficient liquidity");

        liquidity[tokenOut] = available - amountOut;

        require(
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn),
            "transferFrom failed"
        );
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "transfer failed");

        emit Swap(tokenIn, tokenOut, amountIn, amountOut, msg.sender);
    }

    function setRate(address tokenIn, address tokenOut, uint256 rate) external onlyOwner {
        require(rate > 0, "rate must be positive");
        rates[tokenIn][tokenOut] = rate;
    }

    function fundLiquidity(address token, uint256 amount) external onlyOwner {
        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "transferFrom failed"
        );
        liquidity[token] += amount;
    }
}
